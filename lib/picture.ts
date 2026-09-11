"use client";

/**
 * A picture on its way into an email.
 *
 * Two jobs. Read the file the browser handed over, and make it a reasonable
 * size before it goes anywhere.
 *
 * The size matters more than it looks. A phone screenshot is three or four
 * megabytes and two thousand pixels wide; base64 makes it a third larger
 * again; and the hop between this page and the engine is a serverless request
 * capped at about four and a half megabytes. So one screenshot straight off a
 * phone is already too big to send, and would fail somewhere unhelpful.
 *
 * It is also just a better email. Nobody reading a reply in a mail client
 * needs two thousand pixels across a six hundred pixel column, and a publisher
 * on a phone is paying for every one of them.
 */

/** The widest a picture goes out, in pixels on its longest side. */
const WIDEST = 1600;

/** Under this, a file is sent exactly as it is rather than redrawn. */
const SMALL_ENOUGH = 400_000;

/** What the engine will accept. */
export const PICTURE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export interface Picture {
  /** Only for telling one thumbnail from another on the page. */
  id: string;
  name: string;
  mime: string;
  /** Base64, without the data: prefix. What the engine wants. */
  data: string;
  /**
   * For the thumbnail: the same bytes again as a data URL.
   *
   * Not an object URL, which would have to be revoked by hand and leaks a few
   * hundred kilobytes every time somebody changes their mind about a picture.
   * This one is garbage collected with the rest of the object.
   */
  preview: string;
  /** After any shrinking, so the page can say what it is about to send. */
  bytes: number;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file is not a picture this can read."));
    img.src = url;
  });
}

/**
 * Redrawn smaller, as a JPEG.
 *
 * A GIF is left alone whatever its size: redrawing one through a canvas keeps
 * the first frame and throws the animation away, which is not a smaller
 * version of the picture, it is a different picture.
 */
async function shrink(file: File): Promise<{ mime: string; dataUrl: string } | null> {
  if (file.type === "image/gif") return null;

  const original = await readAsDataUrl(file);
  const img = await loadImage(original);

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > WIDEST ? WIDEST / longest : 1;

  // Already small in both senses: nothing to gain, and redrawing a PNG as a
  // JPEG would lose whatever transparency it had for no reason.
  if (scale === 1 && file.size <= SMALL_ENOUGH) return null;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));

  const pen = canvas.getContext("2d");
  if (!pen) return null;

  // White underneath, because a transparent PNG flattened onto nothing comes
  // out black in a JPEG and the picture looks broken rather than smaller.
  pen.fillStyle = "#ffffff";
  pen.fillRect(0, 0, canvas.width, canvas.height);
  pen.drawImage(img, 0, 0, canvas.width, canvas.height);

  return { mime: "image/jpeg", dataUrl: canvas.toDataURL("image/jpeg", 0.82) };
}

/** How many bytes a base64 string stands for. */
function weigh(data: string): number {
  return Math.floor((data.length * 3) / 4);
}

let counter = 0;

/**
 * One file, ready to send.
 *
 * Throws with a sentence somebody can act on rather than returning null: every
 * refusal here is something about the file that the person who picked it can
 * see and change.
 */
export async function readPicture(file: File): Promise<Picture> {
  if (!PICTURE_TYPES.includes(file.type)) {
    return Promise.reject(
      new Error(
        `${file.name || "That file"} is not a picture this can send. ` +
          "PNG, JPEG, GIF and WebP are the kinds that go in an email.",
      ),
    );
  }

  const smaller = await shrink(file);
  const dataUrl = smaller ? smaller.dataUrl : await readAsDataUrl(file);
  const mime = smaller ? smaller.mime : file.type;
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);

  const bytes = weigh(data);
  if (bytes > 4_000_000) {
    throw new Error(`${file.name || "That picture"} is too large to send even after shrinking.`);
  }

  counter += 1;
  return {
    id: `p${counter}`,
    // A JPEG that used to be a PNG should not still be called one.
    name: smaller ? `${file.name.replace(/\.[^.]+$/, "")}.jpg` : file.name || "image",
    mime,
    data,
    preview: dataUrl,
    bytes,
  };
}

/** For the line under the thumbnails. */
export function weight(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
