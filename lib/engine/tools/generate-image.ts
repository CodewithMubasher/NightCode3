import type { ToolImplementation, ToolResult } from "."

export const generateImageTool: ToolImplementation = {
  name: "generate_image",
  description: "Generate an image from a text prompt using AI. Returns a data URL of the generated image.",
  schema: {
    prompt: "string",
    aspect_ratio: "string",
    model: "string",
  },
  async execute(args): Promise<ToolResult> {
    const prompt = (args.prompt as string) || ""
    if (!prompt) {
      return { success: false, error: "Prompt is required" }
    }

    try {
      const { default: puter } = await import("@heyputer/puter.js")
      const aspectRatio = (args.aspect_ratio as string) || "1:1"
      const model = (args.model as string) || "gemini-2.5-flash"

      const result = await puter.ai.txt2img(prompt, {
        model,
        test_mode: true,
        response_format: "b64_json",
        aspect_ratio: aspectRatio,
      })

      const dataUrl = (result as any)?.data?.[0]?.b64_json
        ? `data:image/png;base64,${(result as any).data[0].b64_json}`
        : (result as any)?.image_url
        ? (result as any).image_url
        : null

      if (dataUrl) {
        return {
          success: true,
          data: { image_url: dataUrl, aspect_ratio: aspectRatio },
        }
      }

      const fallback = await puter.ai.chat(prompt, {
        model: model.includes("image") ? model : "gemini-2.5-flash-image",
      }, true)
      const images = (fallback as any)?.message?.images
      if (images?.[0]?.image_url?.url) {
        return {
          success: true,
          data: { image_url: images[0].image_url.url, aspect_ratio: aspectRatio },
        }
      }

      return { success: false, error: "No image in response" }
    } catch (err) {
      return { success: false, error: `Image generation failed: ${(err as Error).message}` }
    }
  },
  async verify(_args, result): Promise<{ verified: boolean; evidence: Record<string, unknown> }> {
    return { verified: result.success, evidence: {} }
  },
}
