import { defineDocumentType, makeSource } from "contentlayer2/source-files";

export const Post = defineDocumentType(() => ({
  name: "Post",
  filePathPattern: "**/*.mdx",
  contentType: "mdx",
  fields: {
    title: { type: "string", required: true },
    date: { type: "date", required: true },
    excerpt: { type: "string", required: true },
    category: { type: "enum", options: ["news", "tournament", "court-update"], required: true },
    coverImage: { type: "string", required: false },
    author: { type: "string", required: false, default: "Padel Club Team" },
  },
  computedFields: {
    slug: { type: "string", resolve: (doc) => doc._raw.flattenedPath },
  },
}));

export default makeSource({
  contentDirPath: "content/blog",
  documentTypes: [Post],
});
