import Foundation

enum PlayerTransport: String { case http, p2p }
struct PlayerConfiguration {
    let transport: PlayerTransport
    static var current: PlayerConfiguration {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "HighpassTransport") as? String,
              let transport = PlayerTransport(rawValue: raw) else { preconditionFailure("HighpassTransport inválido no build") }
        return PlayerConfiguration(transport: transport)
    }
    var title: String { "Highpass \(transport.rawValue.uppercased())" }
    var playerURL: URL { URL(string: "https://p2p.remoto.api.br/player/\(transport.rawValue)/")! }
    var downloadsURL: URL { URL(string: "https://p2p.remoto.api.br/player/#ios")! }
    func permitsNavigation(_ url: URL) -> Bool {
        guard url.scheme == "https", url.host == "p2p.remoto.api.br", url.port == nil || url.port == 443, url.user == nil, url.password == nil else { return false }
        return url.path == playerURL.path || url.path == String(playerURL.path.dropLast())
    }
}
