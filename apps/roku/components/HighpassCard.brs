sub init()
    m.focus = m.top.findNode("focus")
    m.background = m.top.findNode("background")
    m.well = m.top.findNode("well")
    m.initial = m.top.findNode("initial")
    m.poster = m.top.findNode("poster")
    m.title = m.top.findNode("title")
    m.subtitle = m.top.findNode("subtitle")
end sub
sub layout()
    width = m.top.width
    height = m.top.height
    m.focus.width = width
    m.focus.height = height
    m.background.width = width - 6
    m.background.height = height - 6
    if width > 400
        artWidth = 60
        artHeight = height - 20
        titleX = 84
        titleY = 14
        titleWidth = width - 98
        titleHeight = 34
        subtitleY = 48
    else
        artWidth = width - 24
        artHeight = height - 84
        titleX = 12
        titleY = height - 72
        titleWidth = width - 24
        titleHeight = 40
        subtitleY = height - 28
    end if
    for each node in [m.well, m.poster, m.initial]
        node.translation = [12, 10]
        node.width = artWidth
        node.height = artHeight
    end for
    m.title.translation = [titleX, titleY]
    m.title.width = titleWidth
    m.title.height = titleHeight
    m.subtitle.translation = [titleX, subtitleY]
    m.subtitle.width = titleWidth
    m.subtitle.height = 24
end sub
sub onContent()
    entry = m.top.itemContent
    if entry = invalid then return
    m.title.text = entry.title
    m.subtitle.text = entry.description
    m.initial.text = Left(entry.title, 2).UCase()
    agent = CreateObject("roHttpAgent")
    agent.SetCertificatesFile("common:/certs/ca-bundle.crt")
    if entry.imageToken <> invalid and entry.imageToken <> "" then agent.AddHeader("Authorization", "Bearer " + entry.imageToken)
    m.poster.setHttpAgent(agent)
    m.poster.uri = entry.hdPosterUrl
    layout()
end sub
sub onFocus()
    if m.top.gridHasFocus then m.focus.opacity = m.top.focusPercent else m.focus.opacity = 0
end sub
