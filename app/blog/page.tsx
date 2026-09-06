import { pageTitle } from "@/lib/club";
import Link from "next/link";
import { allPosts } from "contentlayer/generated";
import { format } from "date-fns";

export const metadata = { title: pageTitle("News") };

const CATEGORY_LABEL: Record<string, string> = {
  news: "News",
  tournament: "Tournament",
  "court-update": "Court Update",
};

export default function BlogPage() {
  const posts = allPosts.sort((a, b) => +new Date(b.date) - +new Date(a.date));

  return (
    <div className="mx-auto max-w-5xl px-7 sm:px-8 py-14">
      <h1 className="font-heading text-3xl font-extrabold text-ink md:text-4xl">News & tournaments</h1>
      <p className="mt-2 text-ink-muted">Court updates, results, and what's coming up.</p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group rounded-court border border-line bg-surface-base shadow-card p-6 transition-colors hover:border-brand/50"
          >
            <span className="text-xs font-semibold text-brand">{CATEGORY_LABEL[post.category]}</span>
            <h2 className="mt-2 font-heading text-lg font-bold text-ink group-hover:text-brand">
              {post.title}
            </h2>
            <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{post.excerpt}</p>
            <p className="mt-4 text-xs text-ink-muted/70">{format(new Date(post.date), "MMM d, yyyy")}</p>
          </Link>
        ))}
        {posts.length === 0 && (
          <p className="text-sm text-ink-muted/70">No posts yet — add MDX files to /content/blog.</p>
        )}
      </div>
    </div>
  );
}
