import { pageTitle } from "@/lib/club";
import Link from "next/link";
import Image from "next/image";
import { allPosts } from "contentlayer/generated";
import { format } from "date-fns";
import { CATEGORY_LABEL } from "@/lib/blog";

export const metadata = { title: pageTitle("News") };

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
            className="group overflow-hidden rounded-court border border-line bg-surface-base shadow-card transition-colors hover:border-brand/50"
          >
            {/*
              The card reserves the picture's space whether or not a post has
              one, and the aspect ratio is fixed, so the headlines below never
              jump as the images arrive — a grid of cards is the easiest place
              in a site to give away layout shift.

              `sizes` matters here: one column on a phone, two from the `sm`
              breakpoint up to the 5xl container, so a phone downloads a phone-
              sized file instead of the full 1400px original.
            */}
            {post.coverImage && (
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface-muted">
                <Image
                  src={post.coverImage}
                  alt={post.coverAlt ?? ""}
                  fill
                  sizes="(min-width: 640px) 50vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
              </div>
            )}
            <div className="p-6">
              <span className="text-xs font-semibold text-brand">{CATEGORY_LABEL[post.category]}</span>
              <h2 className="mt-2 font-heading text-lg font-bold text-ink group-hover:text-brand">
                {post.title}
              </h2>
              <p className="mt-2 line-clamp-2 text-sm text-ink-muted">{post.excerpt}</p>
              <p className="mt-4 text-xs text-ink-muted/70">{format(new Date(post.date), "MMM d, yyyy")}</p>
            </div>
          </Link>
        ))}
        {posts.length === 0 && (
          <p className="text-sm text-ink-muted/70">No posts yet — add MDX files to /content/blog.</p>
        )}
      </div>
    </div>
  );
}
