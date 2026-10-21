"""Original native-text PDF with a printed, unlinked TOC and a +4 page offset."""
from pathlib import Path
from reportlab.pdfgen import canvas

target = Path(__file__).resolve().parents[1] / 'src/__tests__/fixtures/data/glossa-auto-toc-sample.pdf'
pdf = canvas.Canvas(str(target), pagesize=(600, 800), invariant=1)
pdf.setTitle('Glossa original automatic contents sample')
pdf.setAuthor('Glossa test authors')
titles = ['Chapter 1 Copper', 'Chapter 2 Amber', 'Chapter 3 Silver']
for index in range(16):
    pdf.setFont('Helvetica', 20)
    if index == 1:
        pdf.drawString(40, 750, 'Contents')
        for row, title in enumerate(titles):
            # Separate PDF text items, with no leaders: grouping must use geometry.
            pdf.drawString(40, 680 - row * 55, title)
            pdf.drawRightString(550, 680 - row * 55, str(1 + row * 4))
    elif index in [4, 8, 12]:
        pdf.drawString(40, 750, titles[[4, 8, 12].index(index)])
    else:
        pdf.drawString(40, 750, 'Original reading material')
    pdf.setFont('Helvetica', 14)
    pdf.drawString(40, 100, 'This original fixture contains no private book content.')
    pdf.drawString(40, 60, str(index + 1))
    pdf.showPage()
pdf.save()
print(target)
