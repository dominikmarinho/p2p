sub init()
    m.top.functionName = "fetch"
end sub
sub fetch()
    req = m.top.request
    transfer = CreateObject("roUrlTransfer")
    transfer.SetUrl("https://p2p.remoto.api.br/api/iptv/" + req.path)
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
    transfer.AddHeader("Content-Type", "application/json")
    if req.token <> invalid and req.token <> "" then transfer.AddHeader("Authorization", "Bearer " + req.token)
    port = CreateObject("roMessagePort")
    transfer.SetMessagePort(port)
    if req.body <> invalid
        started = transfer.AsyncPostFromString(FormatJson(req.body))
    else
        started = transfer.AsyncGetToString()
    end if
    if not started
        m.top.result = { ok: false, error: "Falha ao iniciar conexão" }
        return
    end if
    msg = wait(15000, port)
    if type(msg) <> "roUrlEvent"
        transfer.AsyncCancel()
        m.top.result = { ok: false, error: "Tempo de conexão excedido" }
        return
    end if
    status = msg.GetResponseCode()
    data = ParseJson(msg.GetString())
    if req.probe = true then data = { available: status = 200 and Left(msg.GetString().Trim(), 7) = "#EXTM3U" }
    if status >= 200 and status < 300
        m.top.result = { ok: true, data: data, path: req.path }
    else
        errorText = "Operação indisponível"
        if data <> invalid and data.message <> invalid then errorText = data.message
        m.top.result = { ok: false, error: errorText, path: req.path }
    end if
end sub
