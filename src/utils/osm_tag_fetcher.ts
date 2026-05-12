"use strict";

import axios from "axios";

export async function fetch_osm_tags(
  query_string: string | undefined,
): Promise<string[]> {
  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      messages: [
        {
          role: "system",
          content:
            "You seem to know how to map natural language to OpenStreetMap (OSM) tags. The user will ask you to give relevant OSM tags to their query. Search for, and return ONLY existing, real OSM tags and don't invent new ones! You have to ONLY return the relevant tags as a comma-separated string with no spaces, containing each tag. Give the most relevant at most 5 tags. Never write anything else besides the string of tags!!!",
        },
        {
          role: "user",
          content: `Give me relevant and existing OSM tags for the following type of objects: "${query_string}"`,
        },
      ],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 1,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: false,
      stop: null,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.GROQ_API_KEY,
      },
    },
  );

  return response.data.choices[0].message.content
    .split(",")
    .map((s: string) => {
      const key = s.split("=")[0];
      const value = s.split("=")[1];
      return `"${key}"="${value}"`;
    });
}
