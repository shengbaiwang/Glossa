// Original-fixture acceptance of standard PDF data, independent of Glossa's reader.
import AppKit
import Foundation
import PDFKit
let originalURL = URL(fileURLWithPath: CommandLine.arguments[1])
let copyURL = URL(fileURLWithPath: CommandLine.arguments[2])
let original = PDFDocument(url: originalURL)!
let copy = PDFDocument(url: copyURL)!
assert(copy.pageCount == original.pageCount)
for i in 0..<copy.pageCount {
    let before = original.page(at: i)!, after = copy.page(at: i)!
    assert(before.bounds(for: .mediaBox) == after.bounds(for: .mediaBox))
    assert(before.bounds(for: .cropBox) == after.bounds(for: .cropBox))
    assert(before.rotation == after.rotation)
    // Invisible text must not alter the page image; test unannotated pages exactly.
    if i != 1 {
        let size = NSSize(width: 600, height: 800)
        let a = NSBitmapImageRep(data: before.thumbnail(of: size, for: .cropBox).tiffRepresentation!)!
        let b = NSBitmapImageRep(data: after.thumbnail(of: size, for: .cropBox).tiffRepresentation!)!
        assert(a.pixelsWide == b.pixelsWide && a.pixelsHigh == b.pixelsHigh)
        let pixels = a.bytesPerRow * a.pixelsHigh
        let av = Array(Data(bytes: a.bitmapData!, count: pixels)), bv = Array(Data(bytes: b.bitmapData!, count: pixels))
        let error = zip(av, bv).reduce(0) { $0 + abs(Int($1.0) - Int($1.1)) }
        // Native glyph rasterization can differ by a few antialiased edge pixels.
        assert(Double(error) / Double(pixels) < 0.01)
    }
}
if CommandLine.arguments.count > 3 {
    // Existing PDF labels, nested outline and internal links survive an export.
    assert((0..<copy.pageCount).map { copy.page(at: $0)!.label } == (0..<original.pageCount).map { original.page(at: $0)!.label })
    assert(copy.outlineRoot?.child(at: 0)?.label == original.outlineRoot?.child(at: 0)?.label)
    for index in [0, 2] {
        let page = copy.page(at: index)!
        assert(page.annotations.count == original.page(at: index)!.annotations.count)
        assert(page.annotations.contains { ($0.action as? PDFActionGoTo)?.destination.page != nil })
    }
} else {
    assert((copy.page(at: 1)?.string ?? "").contains("Copper marker"))
    assert((copy.page(at: 1)?.string ?? "").contains("本地阅读"))
    assert((copy.page(at: 2)?.string ?? "").contains("Verified"))
    assert(copy.outlineRoot?.child(at: 0)?.destination?.page == copy.page(at: 1))
    assert(copy.outlineRoot?.child(at: 0)?.child(at: 0)?.destination?.page == copy.page(at: 2))
    let note = copy.page(at: 1)!.annotations.first { $0.contents == "Portable original note" }!
    assert(note.type == "Highlight")
    let selection = copy.findString("Copper", withOptions: []).first!
    let selectedBounds = selection.bounds(for: copy.page(at: 1)!)
    let overlap = selectedBounds.intersection(note.bounds)
    assert(!overlap.isNull && overlap.width * overlap.height > note.bounds.width * note.bounds.height * 0.65)
    // Rotated OCR search geometry must match the actual visible word box.
    let page = copy.page(at: 2)!, crop = copy.page(at: 2)!.bounds(for: .cropBox)
    let json = try! JSONSerialization.jsonObject(with: Data(contentsOf: copyURL.deletingLastPathComponent().appendingPathComponent("page-2.json"))) as! [String: Any]
    let word = (json["lines"] as! [[String: Any]]).first { ($0["text"] as? String)?.contains("Verified") == true }!
    let width = crop.height, height = crop.width
    let display = CGRect(x: (word["x"] as! Double) * width, y: (1 - (word["y"] as! Double) - (word["height"] as! Double)) * height, width: (word["width"] as! Double) * width, height: (word["height"] as! Double) * height)
    let expected = display.applying(page.pageRef!.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: width, height: height), rotate: 0, preserveAspectRatio: true).inverted())
    let found = copy.findString("Verified", withOptions: []).first!.bounds(for: page).intersection(expected)
    assert(!found.isNull && found.width * found.height > expected.width * expected.height * 0.65)
    note.contents = "Edited outside Glossa"
    assert(copy.write(to: copyURL))
    assert(PDFDocument(url: copyURL)!.page(at: 1)!.annotations.contains { $0.contents == "Edited outside Glossa" })
}
print("portable PDF verified")
