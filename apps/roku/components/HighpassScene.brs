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
    m.section = "live"
    m.items = []
    m.offset = 0
    m.total = 0
    m.favorites = []
    m.tasks = []
    m.settingsP2p = true
    m.login.observeField("buttonSelected", "onLoginButton")
    m.nav.observeField("itemSelected", "onNav")
    m.catalog.observeField("itemSelected", "onItem")
    m.video.observeField("state", "onVideoState")
    m.timer.observeField("fire", "onStatsTimer")
    m.login.setFocus(true)
    content = CreateObject("roSGNode", "ContentNode")
    for each title in ["Canais ao vivo", "Filmes", "Séries", "Favoritos", "Configurações", "Minha conta"]
        item = content.createChild("ContentNode")
        item.title = title
    end for
    m.nav.content = content
end sub
sub request(path as String, callback as String, body = invalid)
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
    m.nav.setFocus(true)
    loadCatalog()
end sub
sub onNav()
    sections = ["live", "movie", "series", "favorites", "settings", "account"]
    m.section = sections[m.nav.itemSelected]
    m.offset = 0
    m.seriesId = invalid
    if m.section = "favorites"
        showItems(m.favorites)
        m.status.text = "Favoritos · pressione * em um título para alternar"
    else if m.section = "settings"
        showItems([{ id: "p2p", name: "Alternar gateway P2P (Roku usa HLS)", kind: "setting" }])
        m.status.text = "O painel de tráfego mede gateway → swarm. Roku recebe o vídeo por HTTP."
    else if m.section = "account"
        showItems([{ id: "logout", name: "Encerrar sessão", kind: "account" }])
        m.status.text = "Conta: " + m.account.username
    else
        loadCatalog()
    end if
end sub
sub loadCatalog()
    m.status.text = "Carregando programação…"
    request("catalog?kind=" + m.section + "&limit=100&offset=" + m.offset.toStr(), "onCatalog")
end sub
sub onCatalog(event as Object)
    result = event.getData()
    if not result.ok then m.status.text = result.error: return
    m.total = result.data.total
    showItems(result.data.items)
    m.status.text = "Programação disponível · * favoritos · avançar/retroceder troca página"
end sub
sub showItems(items as Object)
    m.items = items
    content = CreateObject("roSGNode", "ContentNode")
    for each entry in items
        child = content.createChild("ContentNode")
        child.title = entry.name
    end for
    m.catalog.content = content
    m.catalog.setFocus(true)
end sub
sub onItem()
    index = m.catalog.itemSelected
    if index < 0 or index >= m.items.count() then return
    entry = m.items[index]
    m.selected = entry
    if entry.kind = "setting"
        m.settingsP2p = not m.settingsP2p
        m.status.text = "Gateway P2P: " + m.settingsP2p.toStr()
    else if entry.kind = "account"
        request("logout", "onLoggedOut", {})
    else if entry.kind = "series"
        m.seriesId = entry.id
        request("series/" + entry.id, "onEpisodes")
    else
        body = { kind: entry.kind, id: entry.id }
        if entry.kind = "episode" then body.seriesId = m.seriesId
        if m.settingsP2p then body.client = "roku"
        request("playback", "onPlayback", body)
    end if
end sub
sub onEpisodes(event as Object)
    result = event.getData()
    if not result.ok then m.status.text = result.error: return
    episodes = result.data
    for each episode in episodes
        episode.kind = "episode"
    end for
    showItems(episodes)
end sub
sub onPlayback(event as Object)
    result = event.getData()
    if not result.ok then m.status.text = result.error: return
    m.playback = result.data
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
    m.top.findNode("badgeBg").visible = true
    m.badge.text = "Aguardando dados de tráfego…"
    m.timer.control = "start"
end sub
sub onStatsTimer()
    cleanupTasks()
    if m.playback <> invalid
        request(m.playback.statsPath.mid(10), "onStats")
    end if
end sub
sub onStats(event as Object)
    result = event.getData()
    if not result.ok then return
    value = result.data
    p2p = Int(value.p2pPercentage * 10 + 0.5) / 10
    http = 0
    if value.totalDownloaded > 0 then http = 100 - p2p
    m.badge.text = "HTTP " + http.toStr() + "% · P2P " + p2p.toStr() + "%" + Chr(10) + value.peers.toStr() + " peers · " + (value.totalDownloaded / 1048576).toStr() + " MB (gateway)"
end sub
sub onVideoState()
    if m.video.state = "error" then m.status.text = "Não foi possível reproduzir. Volte e tente novamente."
end sub
sub onLoggedOut()
    m.token = ""
    m.favorites = []
    m.nav.visible = false
    m.catalog.visible = false
    m.login.visible = true
    m.login.setFocus(true)
    m.status.text = "Sessão encerrada"
end sub
function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if m.video.visible
        if key = "back"
            m.video.control = "stop"
            m.video.visible = false
            m.badge.visible = false
            m.top.findNode("badgeBg").visible = false
            m.timer.control = "stop"
            m.catalog.setFocus(true)
            return true
        end if
        return false
    end if
    if key = "left" and not m.login.visible then m.nav.setFocus(true): return true
    if key = "right" and not m.login.visible then m.catalog.setFocus(true): return true
    if key = "options" and m.catalog.hasFocus()
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
