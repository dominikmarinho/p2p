sub init()
    m.top.backgroundColor = "0x0B1019FF"
    m.status = m.top.findNode("status")
    m.login = m.top.findNode("login")
    m.nav = m.top.findNode("nav")
    m.catalog = m.top.findNode("catalog")
    m.video = m.top.findNode("video")
    m.timer = m.top.findNode("statsTimer")
    m.badge = m.top.findNode("badge")
    m.username = ""
    m.password = ""
    m.token = ""
    m.section = "home"
    m.items = []
    m.offset = 0
    m.total = 0
    m.favorites = []
    m.tasks = []
    m.settingsP2p = true
    m.fallbackUsed = false
    m.pendingSeek = 0
    m.recoveryTick = 0
    m.login.observeField("buttonSelected", "onLoginButton")
    m.nav.observeField("itemSelected", "onNav")
    m.catalog.observeField("itemFocused", "onFocused")
    m.heading = m.top.findNode("heading")
    m.detail = m.top.findNode("detail")
    m.version = CreateObject("roAppInfo").GetVersion()
    m.catalog.observeField("itemSelected", "onItem")
    m.video.observeField("state", "onVideoState")
    m.timer.observeField("fire", "onStatsTimer")
    m.login.setFocus(true)
    content = CreateObject("roSGNode", "ContentNode")
    for each title in ["Início", "Canais ao vivo", "Filmes", "Séries", "Favoritos", "Configurações", "Minha conta"]
        item = content.createChild("ContentNode")
        item.title = title
    end for
    m.nav.content = content
end sub
sub request(path as String, callback as String, body = invalid)
    cleanupTasks()
    task = CreateObject("roSGNode", "ApiTask")
    task.request = { path: path, token: m.token, body: body }
    task.observeField("result", callback)
    m.tasks.push(task)
    task.control = "RUN"
end sub
sub cleanupTasks()
    alive = []
    for each task in m.tasks
        if task.state <> "stop" then alive.push(task)
    end for
    m.tasks = alive
end sub
sub onLoginButton()
    index = m.login.buttonSelected
    if index = 3
        checkUpdates()
        return
    end if
    if index < 2
        keyboard = CreateObject("roSGNode", "KeyboardDialog")
        if index = 0
            keyboard.title = "Usuário"
            keyboard.text = m.username
        else
            keyboard.title = "Senha"
            keyboard.text = m.password
            keyboard.secureMode = true
        end if
        keyboard.buttons = ["Confirmar", "Cancelar"]
        m.editingUsername = index = 0
        keyboard.observeField("buttonSelected", "onKeyboard")
        m.top.dialog = keyboard
    else
        if m.username = "" or m.password = ""
            m.status.text = "Informe usuário e senha"
            return
        end if
        m.status.text = "Conectando…"
        request("login", "onAuthenticated", { username: m.username, password: m.password })
    end if
end sub
sub onKeyboard()
    dialog = m.top.dialog
    if dialog.buttonSelected = 0
        if m.editingUsername then m.username = dialog.text else m.password = dialog.text
    end if
    dialog.close = true
    m.login.setFocus(true)
end sub
sub onAuthenticated(event as Object)
    result = event.getData()
    if not result.ok
        m.status.text = result.error
        return
    end if
    m.token = result.data.token
    m.password = ""
    m.account = result.data.account
    registry = CreateObject("roRegistrySection", "highpass-" + m.account.accountId)
    saved = ParseJson(registry.Read("favorites"))
    if type(saved) = "roArray" then m.favorites = saved
    m.login.visible = false
    m.nav.visible = true
    m.catalog.visible = true
    m.top.findNode("navCaption").visible = true
    m.top.findNode("help").visible = true
    m.top.findNode("eyebrow").text = "HIGH PASS / SUA BIBLIOTECA"
    m.nav.setFocus(true)
    showHome()
end sub
sub onNav()
    sections = ["home", "live", "movie", "series", "favorites", "settings", "account"]
    m.section = sections[m.nav.itemSelected]
    m.offset = 0
    m.seriesId = invalid
    m.total = 0
    m.heading.text = m.nav.content.getChild(m.nav.itemSelected).title
    if m.section = "home"
        showHome()
    else if m.section = "favorites"
        showItems(m.favorites)
        m.status.text = "Favoritos · pressione * em um título para alternar"
    else if m.section = "settings"
        showItems([{ id: "updates", name: "Verificar atualizações", kind: "setting", description: "Versão " + m.version }, { id: "p2p", name: "P2P automático", kind: "setting", description: "Gateway com HTTP de contingência" }])
        m.status.text = "O painel de tráfego mede gateway → swarm. Roku recebe o vídeo por HTTP."
    else if m.section = "account"
        showItems([{ id: "logout", name: "Encerrar sessão", kind: "account", description: "Sair da conta neste aparelho" }])
        m.status.text = "Conta: " + m.account.username
    else
        loadCatalog()
    end if
end sub
sub showHome()
    m.section = "home"
    m.heading.text = "Sua programação. Do seu jeito."
    showItems([{ id: "live", name: "Canais ao vivo", kind: "navigation", description: "Sua programação ao vivo" }, { id: "movie", name: "Filmes", kind: "navigation", description: "Cinema sob demanda" }, { id: "series", name: "Séries", kind: "navigation", description: "Escolha sua próxima maratona" }, { id: "updates", name: "Atualizações", kind: "setting", description: "Versão " + m.version }])
    m.status.text = "Bem-vindo, " + m.account.username + " · Escolha o que assistir."
end sub
sub loadCatalog()
    m.status.text = "Carregando programação…"
    request("catalog?kind=" + m.section + "&limit=100&offset=" + m.offset.toStr(), "onCatalog")
end sub
sub onCatalog(event as Object)
    result = event.getData()
    if not result.ok then m.status.text = result.error: return
    if Left(result.path, Len("catalog?kind=" + m.section + "&")) <> "catalog?kind=" + m.section + "&" then return
    m.total = result.data.total
    showItems(result.data.items)
    m.status.text = "Programação disponível · * favoritos · avançar/retroceder troca página"
end sub
sub showItems(items as Object)
    m.items = items
    m.detail.visible = m.section = "live"
    if m.section = "live"
        m.catalog.numColumns = 1
        m.catalog.numRows = 5
        m.catalog.itemSize = [440, 78]
        m.catalog.itemSpacing = [0, 10]
    else if m.section = "settings" or m.section = "account" or m.seriesId <> invalid
        m.catalog.numColumns = 1
        m.catalog.numRows = 4
        m.catalog.itemSize = [920, 84]
        m.catalog.itemSpacing = [0, 14]
    else
        m.catalog.numColumns = 4
        m.catalog.numRows = 1
        if m.section = "home" then m.catalog.itemSize = [214, 228] else m.catalog.itemSize = [214, 388]
        m.catalog.itemSpacing = [16, 14]
    end if
    content = CreateObject("roSGNode", "ContentNode")
    for each entry in items
        child = content.createChild("ContentNode")
        child.title = entry.name
        child.description = "SOB DEMANDA"
        if entry.kind = "live" then child.description = "AO VIVO"
        if entry.kind = "series" then child.description = "SÉRIE · TEMPORADAS"
        if entry.description <> invalid then child.description = entry.description
        child.addField("imageToken", "string", false)
        if entry.image <> invalid and entry.image <> "" and (entry.kind = "live" or entry.kind = "movie" or entry.kind = "series")
            child.hdPosterUrl = "https://p2p.remoto.api.br/api/iptv/artwork/" + entry.kind + "/" + entry.id
            child.imageToken = m.token
        end if
    end for
    m.catalog.content = content
    m.catalog.setFocus(true)
end sub
sub onItem()
    index = m.catalog.itemSelected
    if index < 0 or index >= m.items.count() then return
    entry = m.items[index]
    m.selected = entry
    if entry.kind = "navigation"
        sections = ["home", "live", "movie", "series", "favorites", "settings", "account"]
        for i = 0 to sections.count() - 1
            if sections[i] = entry.id
                m.nav.jumpToItem = i
                m.section = entry.id
                m.heading.text = entry.name
                m.offset = 0
                loadCatalog()
                return
            end if
        end for
    else if entry.kind = "setting"
        if entry.id = "updates"
            checkUpdates()
        else
            m.status.text = "Gateway P2P automático com HTTP de contingência. Roku recebe HTTP do gateway."
        end if
    else if entry.kind = "account"
        releasePlayback()
        request("logout", "onLoggedOut", {})
    else if entry.kind = "series"
        m.seriesId = entry.id
        request("series/" + entry.id, "onEpisodes")
    else
        body = { kind: entry.kind, id: entry.id }
        if entry.kind = "episode"
            if entry.seriesId <> invalid then body.seriesId = entry.seriesId else body.seriesId = m.seriesId
        end if
        body.client = "roku"
        request("playback", "onPlayback", body)
    end if
end sub
sub onEpisodes(event as Object)
    result = event.getData()
    if not result.ok then m.status.text = result.error: return
    if m.seriesId = invalid then return
    if result.path <> "series/" + m.seriesId then return
    m.total = 0
    episodes = result.data
    for each episode in episodes
        episode.kind = "episode"
        episode.seriesId = m.seriesId
    end for
    showItems(episodes)
end sub
sub releasePlayback()
    if m.playback = invalid then return
    previous = m.playback
    m.playback = invalid
    if previous.delivery = invalid or previous.delivery.seedPath = invalid then return
    task = CreateObject("roSGNode", "ApiTask")
    task.request = { path: previous.delivery.seedPath.mid(10), token: m.token, method: "DELETE" }
    task.observeField("result", "onPlaybackReleased")
    m.tasks.push(task)
    task.control = "RUN"
end sub
sub onPlaybackReleased()
    cleanupTasks()
end sub
sub onPlayback(event as Object)
    result = event.getData()
    if not result.ok then m.status.text = result.error: return
    releasePlayback()
    m.playback = result.data
    m.fallbackUsed = false
    content = CreateObject("roSGNode", "ContentNode")
    content.url = "https://p2p.remoto.api.br" + m.playback.url
    content.streamFormat = "hls"
    content.title = m.selected.name
    content.HttpHeaders = ["Authorization: Bearer " + m.token]
    m.video.content = content
    m.video.visible = true
    m.video.setFocus(true)
    m.video.control = "play"
    m.badge.visible = true
    m.badge.text = "Aguardando dados de tráfego…"
    m.timer.control = "start"
end sub
sub onStatsTimer()
    cleanupTasks()
    if m.playback <> invalid
        request(m.playback.statsPath.mid(10), "onStats")
        m.recoveryTick++
        if m.fallbackUsed and m.recoveryTick mod 5 = 0
            task = CreateObject("roSGNode", "ApiTask")
            task.request = { path: m.playback.url.mid(10), token: m.token, probe: true }
            task.observeField("result", "onRecoveryProbe")
            m.tasks.push(task)
            task.control = "RUN"
        end if
    end if
end sub
sub onRecoveryProbe(event as Object)
    result = event.getData()
    if not m.video.visible or not m.fallbackUsed or not result.ok then return
    if result.data = invalid or not result.data.available then return
    m.pendingSeek = m.video.position
    m.fallbackUsed = false
    content = CreateObject("roSGNode", "ContentNode")
    content.url = "https://p2p.remoto.api.br" + m.playback.url
    content.streamFormat = "hls"
    content.title = m.selected.name
    content.HttpHeaders = ["Authorization: Bearer " + m.token]
    m.video.content = content
    m.video.control = "play"
end sub
sub onStats(event as Object)
    result = event.getData()
    if not result.ok then return
    value = result.data
    p2p = Int(value.p2pPercentage * 10 + 0.5) / 10
    http = 0
    if value.totalDownloaded > 0 then http = 100 - p2p
    m.badge.text = "HTTP " + http.toStr() + "% · P2P " + p2p.toStr() + "% · " + value.peers.toStr() + " peers · " + (value.totalDownloaded / 1048576).toStr() + " MB (gateway)"
end sub
sub onVideoState()
    if m.video.state = "finished"
        m.timer.control = "stop"
        releasePlayback()
        return
    end if
    if m.video.state = "playing" and m.pendingSeek > 0
        m.video.seek = m.pendingSeek
        m.pendingSeek = 0
    end if
    if m.video.state <> "error" then return
    if not m.fallbackUsed and m.playback.directUrl <> invalid and m.playback.directUrl <> m.playback.url
        m.fallbackUsed = true
        m.pendingSeek = m.video.position
        content = CreateObject("roSGNode", "ContentNode")
        content.url = "https://p2p.remoto.api.br" + m.playback.directUrl
        content.streamFormat = m.playback.sourceFormat
        content.title = m.selected.name
        content.HttpHeaders = ["Authorization: Bearer " + m.token]
        m.video.content = content
        m.video.control = "play"
    else
        m.status.text = "Não foi possível reproduzir. Volte e tente novamente."
    end if
end sub
sub onLoggedOut()
    m.token = ""
    m.favorites = []
    m.nav.visible = false
    m.catalog.visible = false
    m.detail.visible = false
    m.top.findNode("navCaption").visible = false
    m.top.findNode("help").visible = false
    m.heading.text = "Sua programação. Do seu jeito."
    m.login.visible = true
    m.login.setFocus(true)
    m.status.text = "Sessão encerrada"
end sub
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if m.video.visible
        if key = "back"
            releasePlayback()
            m.video.control = "stop"
            m.video.visible = false
            m.badge.visible = false
            m.timer.control = "stop"
            m.catalog.setFocus(true)
            return true
        end if
        return false
    end if
    if key = "left" and not m.login.visible
        if m.catalog.hasFocus() and m.catalog.numColumns > 1 and m.catalog.itemFocused mod m.catalog.numColumns <> 0 then return false
        m.nav.setFocus(true)
        return true
    end if
    if key = "right" and m.nav.hasFocus() and not m.login.visible then m.catalog.setFocus(true): return true
    if key = "back" and not m.login.visible
        if m.seriesId <> invalid
            m.seriesId = invalid
            loadCatalog()
        else
            m.nav.setFocus(true)
        end if
        return true
    end if
    if key = "options" and m.catalog.hasFocus() and m.section <> "settings" and m.section <> "account" and m.section <> "home"
        index = m.catalog.itemFocused
        if index >= 0 and index < m.items.count()
            entry = m.items[index]
            found = false
            updated = []
            for each favorite in m.favorites
                if favorite.id = entry.id and favorite.kind = entry.kind then found = true else updated.push(favorite)
            end for
            if not found then updated.push(entry)
            m.favorites = updated
            registry = CreateObject("roRegistrySection", "highpass-" + m.account.accountId)
            registry.Write("favorites", FormatJson(updated))
            registry.Flush()
            m.status.text = "Favoritos atualizados"
        end if
        return true
    end if
    if (key = "fastforward" or key = "rewind") and m.total > 100
        if key = "fastforward" and m.offset + 100 < m.total then m.offset += 100
        if key = "rewind" and m.offset >= 100 then m.offset -= 100
        loadCatalog()
        return true
    end if
    return false
end function

sub onFocused()
    if m.section <> "live" then return
    index = m.catalog.itemFocused
    if index < 0 or index >= m.items.count() then return
    m.focusedChannel = m.items[index].id
    m.top.findNode("detailTitle").text = m.items[index].name
    m.top.findNode("detailGuide").text = "OK para assistir · * para favoritar"
    request("epg/" + m.focusedChannel, "onGuide")
end sub
sub onGuide(event as Object)
    result = event.getData()
    if m.section <> "live" or not result.ok then return
    if result.path <> "epg/" + m.focusedChannel then return
    text = "Guia não disponibilizado pela operadora."
    if type(result.data) = "roArray" and result.data.count() > 0
        text = ""
        last = result.data.count() - 1
        if last > 1 then last = 1
        for i = 0 to last
            entry = result.data[i]
            text += entry.title + Chr(10)
        end for
    end if
    m.top.findNode("detailGuide").text = text + Chr(10) + Chr(10) + "OK para assistir · * para favoritar"
end sub
sub checkUpdates()
    m.status.text = "Verificando atualizações…"
    cleanupTasks()
    task = CreateObject("roSGNode", "ApiTask")
    task.request = { path: "clients.json", publicManifest: true }
    task.observeField("result", "onUpdates")
    m.tasks.push(task)
    task.control = "RUN"
end sub
sub onUpdates(event as Object)
    result = event.getData()
    message = "Não foi possível verificar. Confira a conexão e tente novamente."
    if result.ok and result.data <> invalid and result.data.roku <> invalid
        latest = result.data.roku.versionName
        if type(latest) = "roString" or type(latest) = "String"
            message = "Instalado: " + m.version + ". Versão publicada: " + latest + "." + Chr(10) + Chr(10)
            if latest = m.version then message += "Seu aplicativo está atualizado." else message += "Há uma versão diferente disponível."
            message += Chr(10) + Chr(10) + "Para apps da loja: Início > Configurações > Sistema > Atualização do sistema > Verificar agora. Pacotes de desenvolvimento devem ser reinstalados no modo de desenvolvedor."
        end if
    end if
    dialog = CreateObject("roSGNode", "Dialog")
    dialog.title = "Atualizações do Highpass Play"
    dialog.message = message
    dialog.buttons = ["Fechar"]
    dialog.observeField("buttonSelected", "onUpdateDialog")
    m.top.dialog = dialog
    m.status.text = "Versão " + m.version + " · Highpass Play para Roku"
end sub
sub onUpdateDialog()
    m.top.dialog.close = true
    if m.login.visible then m.login.setFocus(true) else m.catalog.setFocus(true)
end sub
