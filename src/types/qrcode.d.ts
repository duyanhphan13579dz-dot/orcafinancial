declare module "qrcode" {
  export type QRCodeErrorCorrectionLevel =
    | "L"
    | "M"
    | "Q"
    | "H";

  export interface QRCodeToDataURLOptions {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
    type?: "image/png" | "image/jpeg" | "image/webp";
    color?: {
      dark?: string;
      light?: string;
    };
  }

  interface QRCodeStatic {
    toDataURL(
      text: string,
      options?: QRCodeToDataURLOptions,
    ): Promise<string>;
  }

  const QRCode: QRCodeStatic;

  export default QRCode;
}
