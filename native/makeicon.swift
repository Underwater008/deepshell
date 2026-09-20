import AppKit

// DeepShell icon: a pearl scallop shell on a deep-sea blue rounded square.
// Usage: swift makeicon.swift <output.png>   (renders 1024x1024)

let S: CGFloat = 1024
let image = NSImage(size: NSMakeSize(S, S))
image.lockFocus()
NSColor.clear.set()
NSRect(x: 0, y: 0, width: S, height: S).fill()

// --- background: deep-sea gradient rounded square (macOS icon shape) ---
let inset: CGFloat = 90
let frame = NSRect(x: inset, y: inset, width: S - 2 * inset, height: S - 2 * inset)
let bg = NSBezierPath(roundedRect: frame, xRadius: 190, yRadius: 190)
let grad = NSGradient(starting: NSColor(calibratedRed: 0.10, green: 0.28, blue: 0.62, alpha: 1),
                      ending: NSColor(calibratedRed: 0.03, green: 0.10, blue: 0.30, alpha: 1))!
grad.draw(in: bg, angle: -90)

// --- shell geometry: fan wedge from a hinge point ---
let hinge = NSPoint(x: S / 2, y: inset + 200)
let radius: CGFloat = 340
let startA: CGFloat = 32, endA: CGFloat = 148

let shell = NSBezierPath()
shell.move(to: hinge)
shell.appendArc(withCenter: hinge, radius: radius, startAngle: startA, endAngle: endA, clockwise: false)
shell.close()

let shellGrad = NSGradient(starting: NSColor(calibratedRed: 1.00, green: 0.97, blue: 0.90, alpha: 1),
                           ending: NSColor(calibratedRed: 0.82, green: 0.75, blue: 0.65, alpha: 1))!
shellGrad.draw(in: shell, angle: -90)

// --- ribs (clipped to the shell wedge) ---
NSGraphicsContext.current?.saveGraphicsState()
shell.addClip()
NSColor(calibratedRed: 0.68, green: 0.59, blue: 0.46, alpha: 1).setStroke()
for i in 1..<9 {
    let a = (startA + (endA - startA) * CGFloat(i) / 9.0) * .pi / 180
    let p = NSPoint(x: hinge.x + cos(a) * (radius + 4), y: hinge.y + sin(a) * (radius + 4))
    let rib = NSBezierPath()
    rib.move(to: NSPoint(x: hinge.x + cos(a) * 40, y: hinge.y + sin(a) * 40))
    rib.line(to: p)
    rib.lineWidth = 8
    rib.lineCapStyle = .round
    rib.stroke()
}
NSGraphicsContext.current?.restoreGraphicsState()

// --- hinge bump ---
let bump = NSBezierPath(ovalIn: NSRect(x: hinge.x - 40, y: hinge.y - 18, width: 80, height: 52))
NSColor(calibratedRed: 0.90, green: 0.84, blue: 0.74, alpha: 1).setFill()
bump.fill()

image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else { fatalError("render failed") }
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.png"
try png.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
