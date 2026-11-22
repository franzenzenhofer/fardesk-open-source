/// Tailscale is mandatory: all transport security is Tailscale (WireGuard), Fardesk adds no TLS. The words below are the
/// only place that says so; the iPhone pairing screen, the Mac pairing view, the CLI and `AppModel.pair(link:)` all use them.
public enum TailscaleRequirement {
    /// Shown instead of the scanner (and as the refusal of a pairing attempt) when this device has no tailnet address.
    public static let offMessage =
        "Fardesk works only over Tailscale. Your phone is not on Tailscale right now. Open the Tailscale app, turn it on, then come back."

    /// The one line above the scanner while Tailscale is on.
    public static let onLine = "Connected to Tailscale"

    /// The instruction under the scanner.
    public static let scanInstruction = "On your computer run `fardeskd pair`, then point the camera at the code."

    /// The refusal when a photo holds no pairing code.
    public static let noCodeInPhoto = "No pairing code found in the photo. Hold the phone closer and try again."
}

extension AppModel {
    /// Whether this device is on Tailscale right now (the same check `pair(link:)` uses): the pairing screens read it to
    /// show the scanner or the way to turn Tailscale on.
    public var isOnTailscale: Bool { configuration.tailscaleIsOn() }
}
