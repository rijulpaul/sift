import { tool } from "langchain";
import * as z from "zod";
import type { MaskedUrl } from "../../process";
import { DescribeImageAgent } from "../describeImage/agent";
import type { context, ToolConfig } from "./agent";

let describeImageAgent: DescribeImageAgent | undefined;

export const describeImage = tool(
  async (link_id, config) => {
    const linkId = link_id.toLowerCase().startsWith("link_")
      ? Number(link_id.toLowerCase().replace("link_", ""))
      : Number(link_id);
    const context: context = config.context;
    const link: MaskedUrl | undefined = context.maskedUrls[linkId];

    if (link === undefined) {
      return `Invalid link id ${link_id}`;
    } else if (link.isImage) {
      const toolConfig: ToolConfig = context.toolConfig;
      if (!toolConfig.vlmProvider || !toolConfig.vlmName) {
        throw new Error(
          "Vision settings (vlm_provider, vlm_name) are not configured, but image processing was requested",
        );
      }
      if (!describeImageAgent) {
        describeImageAgent = await DescribeImageAgent.create({
          modelProvider: toolConfig.vlmProvider,
          model: toolConfig.vlmName,
        });
      }

      // invoke() is an async generator; collect its chunks into the full text.
      let description = "";
      for await (const message of describeImageAgent.invoke(link.url)) {
        description += message;
      }
      return description;
    } else {
      return "Not an Image Url";
    }
  },
  {
    name: "describe_image",
    description:
      // "Given a LINK_{ID} get the real Link",
      "Given a LINK_{ID}, get the description of resource present in the original link if it is a valid Image",
    schema: z.string(),
  },
);
