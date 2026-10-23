"""Original unlinked, two-page contents with independently located part pages."""
from pathlib import Path
from reportlab.pdfgen import canvas

target = Path(__file__).resolve().parents[1] / 'src/__tests__/fixtures/data/glossa-part-toc-sample.pdf'
pdf = canvas.Canvas(str(target), pagesize=(600, 800), invariant=1)
pdf.setTitle('Glossa original multi-part contents sample')
pdf.setAuthor('Glossa test authors')
destinations = {
    3: 'Preface', 4: 'Part I Hills', 5: 'Copper observations',
    7: 'Amber experiments', 9: 'Part II Cities', 10: 'Silver results',
    13: 'Afterword', 14: 'Appendix 1: Materials',
}
for index in range(16):
    if index in (0, 1):
        pdf.setFont('Helvetica', 20)
        if index == 0:
            pdf.drawString(45, 750, 'Contents')
        rows = (
            [('Preface', 4, 660, 45, 18), ('Part I Hills', None, 550, 45, 22),
             ('Copper observations', 6, 470, 70, 16)]
            if index == 0 else
            [('Amber experiments', 8, 680, 70, 16), ('Part II Cities', None, 570, 45, 22),
             ('Silver results', 11, 490, 70, 16), ('Afterword', 14, 340, 45, 22),
             ('Appendix 1: Materials', 15, 240, 45, 22)]
        )
        for title, folio, y, x, size in rows:
            pdf.setFont('Helvetica', size)
            pdf.drawString(x, y, title)
            if folio is not None:
                pdf.drawRightString(550, y, str(folio))
    else:
        pdf.setFont('Helvetica', 24)
        pdf.drawString(45, 650, destinations.get(index, 'Original reading material'))
        pdf.setFont('Helvetica', 14)
        pdf.drawString(45, 480, 'Independently written material for hierarchy verification.')
    pdf.setFont('Helvetica', 12)
    pdf.drawString(45, 55, str(index + 1))
    pdf.showPage()
pdf.save()
print(target)
