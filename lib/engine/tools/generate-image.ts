// Uses Pollinations.ai — completely free, no API key, no signup required.
// Just a GET request that returns a JPEG image directly.

const VALID_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"]

function ratioDims(ratio: string): { width: number; height: number } {
  switch (ratio) {
    case "16:9": return { width: 1280, height: 720 }
    case "9:16": return { width: 720,  height: 1280 }
    case "4:3":  return { width: 1024, height: 768 }
    case "3:4":  return { width: 768,  height: 1024 }
    default:     return { width: 1024, height: 1024 }
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export const generateImageTool = {
  name: "generate_image",
  description:
    "Generate an image from a text prompt. Use this whenever the user asks to create, draw, generate, or visualize an image. The image appears inline in the chat with a shimmer loading effect while generating.",
  schema: {
    prompt: "string — detailed description of the image to generate",
    aspect_ratio: "string — one of: 1:1 | 16:9 | 9:16 | 4:3 | 3:4 (default: 1:1)",
    image_id: "string — unique ID for this image (provided by the system)",
  },

  async execute(args: { prompt: string; aspect_ratio?: string; image_id: string }) {
    const prompt = (args.prompt ?? "").trim()
    if (!prompt) return { success: false, error: "prompt is required" }

    const aspectRatio = VALID_RATIOS.includes(args.aspect_ratio ?? "") ? args.aspect_ratio! : "1:1"
    const { width, height } = ratioDims(aspectRatio)

    const encodedPrompt = encodeURIComponent(prompt)
    const seed = Math.floor(Math.random() * 999999)
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true&enhance=true`

    console.log(`[generate_image] Calling Pollinations: "${prompt.slice(0, 80)}..." (${width}x${height})`)

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "Accept": "image/jpeg,image/*" },
        signal: AbortSignal.timeout(60_000),
      })

      console.log(`[generate_image] Pollinations status: ${res.status}`)

      if (!res.ok) {
        const errText = await res.text()
        return {
          success: false,
          error: `Pollinations error ${res.status}: ${errText.slice(0, 200)}`,
        }
      }

      const blob = await res.blob()
      const mimeType = res.headers.get("content-type") || "image/jpeg"
      const b64 = await blobToBase64(blob)
      const dataUrl = `data:${mimeType};base64,${b64}`

      console.log(`[generate_image] Success — ${mimeType}, ${Math.round(b64.length / 1024)}KB base64`)

      return {
        success: true,
        data: {
          image_id: args.image_id,
          url: dataUrl,
          prompt,
          aspectRatio,
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      console.log(`[generate_image] Failed: ${msg}`)
      return { success: false, error: `Fetch error: ${msg}` }
    }
  },

  async verify(
    _args: { prompt: string; aspect_ratio?: string; image_id: string },
    result: { success: boolean; data?: { url: string } }
  ) {
    if (!result.success) return { verified: false, discrepancy: "Tool returned failure" }
    if (!result.data?.url?.startsWith("data:image/")) {
      return { verified: false, discrepancy: "Result does not contain a valid image data URL" }
    }
    return { verified: true, evidence: { hasImage: true, urlLength: result.data.url.length } }
  },
}
