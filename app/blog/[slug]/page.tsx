import { allPosts } from "contentlayer/generated";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { useMDXComponent } from "next-contentlayer2/hooks";
import { pageTitle } from "@/lib/club";

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
    <article className="mx-auto max-w-2xl px-7 sm:px-8 py-14">
      <p className="text-xs font-semibold text-brand">{post.category}</p>
      <h1 className="mt-2 font-heading text-3xl font-extrabold text-ink">{post.title}</h1>
      <p className="mt-2 text-sm text-ink-muted/70">
        {format(new Date(post.date), "MMMM d, yyyy")} · {post.author}
      </p>
      <div className="prose prose-invert prose-headings:font-heading prose-a:text-brand mt-8 max-w-none">
        <PostBody code={post.body.code} />
      </div>
    </article>
  );
}
