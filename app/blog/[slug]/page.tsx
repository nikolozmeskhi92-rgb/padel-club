import { allPosts } from "contentlayer/generated";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { useMDXComponent } from "next-contentlayer2/hooks";

export function generateStaticParams() {
  return allPosts.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const post = allPosts.find((p) => p.slug === params.slug);
  return { title: post ? `${post.title} — Nexus Padel Club` : "Post not found" };
}

export default function PostPage({ params }: { params: { slug: string } }) {
  const post = allPosts.find((p) => p.slug === params.slug);
  if (!post) notFound();

  const MDXContent = useMDXComponent(post.body.code);

  return (
    <article className="mx-auto max-w-2xl px-6 py-14">
      <p className="text-xs font-semibold text-brand">{post.category}</p>
      <h1 className="mt-2 font-heading text-3xl font-extrabold text-ink">{post.title}</h1>
      <p className="mt-2 text-sm text-ink-muted/70">
        {format(new Date(post.date), "MMMM d, yyyy")} · {post.author}
      </p>
      <div className="prose prose-invert prose-headings:font-heading prose-a:text-brand mt-8 max-w-none">
        <MDXContent />
      </div>
    </article>
  );
}
