import Foundation
import FardeskModels

/// Colour maths for the colour table test. Checked for reuse: no maintained Swift package for CIEDE2000 or
/// WCAG contrast that is lighter than these 70 lines, and a test-only dependency would not be worth it.
enum ColourMath {
    typealias Channels = (red: Int, green: Int, blue: Int)

    private static func linear(_ channel: Int) -> Double {
        let c = Double(channel) / 255
        return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
    }

    /// Relative luminance, https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
    static func luminance(_ c: Channels) -> Double {
        0.2126 * linear(c.red) + 0.7152 * linear(c.green) + 0.0722 * linear(c.blue)
    }

    /// Contrast ratio, https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio : (L1 + 0.05) / (L2 + 0.05), L1 the lighter.
    static func contrast(_ a: Channels, _ b: Channels) -> Double {
        let (la, lb) = (luminance(a), luminance(b))
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    /// CIE Lab (D65), https://www.w3.org/TR/css-color-4/#color-conversion-code
    static func lab(_ c: Channels) -> (l: Double, a: Double, b: Double) {
        let (r, g, b) = (linear(c.red), linear(c.green), linear(c.blue))
        let x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
        let y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
        let z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883
        func f(_ t: Double) -> Double { t > 216.0 / 24389 ? cbrt(t) : (24389.0 / 27 * t + 16) / 116 }
        return (116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z)))
    }

    /// CIEDE2000 (Sharma, Wu, Dalal 2005; https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/ciede2000noteCRNA.pdf).
    static func deltaE2000(_ one: Channels, _ two: Channels) -> Double {
        deltaE2000(lab(one), lab(two))
    }

    static func deltaE2000(_ p: (l: Double, a: Double, b: Double), _ q: (l: Double, a: Double, b: Double)) -> Double {
        let meanChroma = (hypot(p.a, p.b) + hypot(q.a, q.b)) / 2
        let g = 0.5 * (1 - sqrt(pow(meanChroma, 7) / (pow(meanChroma, 7) + pow(25, 7))))
        let (ap, aq) = ((1 + g) * p.a, (1 + g) * q.a)
        let (cp, cq) = (hypot(ap, p.b), hypot(aq, q.b))
        let (hp, hq) = (hue(p.b, ap), hue(q.b, aq))
        let dL = q.l - p.l
        let dC = cq - cp
        var dh = 0.0
        if cp * cq != 0 {
            dh = hq - hp
            if dh > 180 { dh -= 360 } else if dh < -180 { dh += 360 }
        }
        let dH = 2 * sqrt(cp * cq) * sin(radians(dh / 2))
        let meanL = (p.l + q.l) / 2
        let meanC = (cp + cq) / 2
        var meanH = hp + hq
        if cp * cq != 0 {
            if abs(hp - hq) <= 180 { meanH /= 2 } else { meanH = (hp + hq < 360 ? meanH + 360 : meanH - 360) / 2 }
        }
        let t = 1 - 0.17 * cos(radians(meanH - 30)) + 0.24 * cos(radians(2 * meanH))
            + 0.32 * cos(radians(3 * meanH + 6)) - 0.20 * cos(radians(4 * meanH - 63))
        let rotation = -sin(radians(60 * exp(-pow((meanH - 275) / 25, 2)))) * 2 * sqrt(pow(meanC, 7) / (pow(meanC, 7) + pow(25, 7)))
        let sl = 1 + 0.015 * pow(meanL - 50, 2) / sqrt(20 + pow(meanL - 50, 2))
        let (sc, sh) = (1 + 0.045 * meanC, 1 + 0.015 * meanC * t)
        let (tl, tc, th) = (dL / sl, dC / sc, dH / sh)
        return sqrt(tl * tl + tc * tc + th * th + rotation * tc * th)
    }

    private static func hue(_ b: Double, _ a: Double) -> Double {
        b == 0 && a == 0 ? 0 : (atan2(b, a) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }

    private static func radians(_ degrees: Double) -> Double { degrees * .pi / 180 }
}
