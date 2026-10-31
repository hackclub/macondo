import { PDFDocument } from "pdf-lib";
import type { PublicCertificate } from "./certificates";
import { cachedCertificate } from "./certificate-cache";
import { renderCertificatePng } from "./certificate-image";

export function renderCertificatePdf(cert: PublicCertificate): Promise<Buffer> {
  return cachedCertificate(cert, "pdf", async () => {
    const png = await renderCertificatePng(cert);
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(png);
    pdf.addPage([image.width, image.height]).drawImage(image, {
      x: 0, y: 0, width: image.width, height: image.height,
    });
    return Buffer.from(await pdf.save());
  });
}
