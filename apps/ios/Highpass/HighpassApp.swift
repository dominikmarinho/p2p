import SwiftUI
import AVFoundation

@main
struct HighpassApp: App {
    private let configuration = PlayerConfiguration.current
    init() {
        // Playback category honours playback volume and does not request microphone access.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }
    var body: some Scene { WindowGroup { PlayerScreen(configuration: configuration).preferredColorScheme(.dark) } }
}
