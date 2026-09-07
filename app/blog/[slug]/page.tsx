import { allPosts } from "contentlayer/generated";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { useMDXComponent } from "next-contentlayer2/hooks";
import { pageTitle } from "@/lib/club";
import { categoryLabel } from "@/lib/blog";

export function generateStaticParams() {
  return allPosts.map((p) => ({ slug: p.slug }));
}

/** Next 15 makes `params` a Promise — both entry points have to await it. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = allPosts.find((p) => p.slug === slug);
  return { title: post ? pageTitle(post.title) : "Post not found" };
}

/**
 * `useMDXComponent` is a hook, so it cannot be called from an async component.
 * The page awaits `params` and hands the compiled body to this synchronous
 * child, which is where the hook is allowed to run.
 */
function PostBody({ code }: { code: string }) {
  const MDXContent = useMDXComponent(code);
  return <MDXContent />;
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = allPosts.find((p) => p.slug === slug);
  if (!post) notFound();

  return (
    <article className="mx-auto max-w-2xl px-7 sm:px-8 py-10 sm:py-14">
      {/*
        A way back to the list. On a phone this is the only one there is —
        the article is a leaf, and leaving it otherwise means the browser's
        own Back button or the menu.
      */}
      <Link
        href="/blog"
        className="-ml-1 inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-brand"
      >
        <ChevronLeft className="h-4 w-4" />
        All news
      </Link>

      <p className="mt-6 text-xs font-semibold text-brand">{categoryLabel(post.category)}</p>
      <h1 className="mt-2 font-heading text-3xl font-extrabold text-ink">{post.title}</h1>
      <p className="mt-2 text-sm text-ink-muted/70">
        {format(new Date(post.date), "MMMM d, yyyy")} · {post.author}
      </p>

      {/*
        Below the headline rather than above it. A photo at the very top of a
        phone screen pushes the thing you tapped for off the fold, and you
        arrive not knowing whether you opened the right article.

        `priority` because this is the largest element on the page and the one
        the load is measured by; the fixed aspect ratio keeps the text under it
        from moving as it arrives.
      */}
      {post.coverImage && (
        <div className="relative mt-6 aspect-[16/10] w-full overflow-hidden rounded-court bg-surface-muted">
          <Image
            src={post.coverImage}
            alt={post.coverAlt ?? ""}
            fill
            priority
            sizes="(min-width: 768px) 42rem, 100vw"
            className="object-cover"
          />
        </div>
      )}
      <div className="article-body mt-8">
        <PostBody code={post.body.code} />
      </div>
    </article>
  );
}
