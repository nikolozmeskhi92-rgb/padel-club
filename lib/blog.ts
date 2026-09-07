/**
 * How a post's category is written for a reader.
 *
 * The raw values are the contentlayer enum, and the article page used to print
 * them straight out, so a court update was headed "court-update". One map, used
 * by both the list and the article, keeps them saying the same thing.
 */
export const CATEGORY_LABEL: Record<string, string> = {
  news: "News",
  tournament: "Tournament",
  "court-update": "Court update",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category] ?? category;
}
