import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getAllPosts } from "@/lib/blog";
import { Navbar } from "@/components/navbar";

export const metadata: Metadata = {
  title: "Blog | DataToRAG",
  description:
    "Insights on connecting enterprise data to AI assistants through the Model Context Protocol.",
  openGraph: {
    title: "Blog | DataToRAG",
    description:
      "Insights on connecting enterprise data to AI assistants through the Model Context Protocol.",
    type: "website",
    url: "https://datatorag.com/blog",
  },
};

function AuthorAvatar({
  author,
  authorImage,
  size = 24,
}: {
  author: string;
  authorImage?: string;
  size?: number;
}) {
  if (authorImage) {
    return (
      <Image
        src={authorImage}
        alt={author}
        width={size}
        height={size}
        className="rounded-full object-cover"
      />
    );
  }

  const initials = author
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="flex items-center justify-center rounded-full bg-primary text-primary-foreground"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      <span className="font-semibold leading-none">{initials}</span>
    </div>
  );
}

export default function BlogListingPage() {
  const posts = getAllPosts();

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 pb-16 pt-32 sm:pb-20 sm:pt-36">
          <div className="animate-fade-in-up">
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Blog
            </h1>
            <p className="mt-3 text-muted-foreground">
              Insights on making your data AI-ready.
            </p>
          </div>

          {posts.length === 0 ? (
            <p className="mt-16 text-center text-muted-foreground">
              Articles coming soon.
            </p>
          ) : (
            <div className="mt-12 space-y-6">
              {posts.map((post, i) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="animate-fade-in-up group block overflow-hidden rounded-2xl border border-border transition-all duration-200 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] hover:-translate-y-0.5"
                  style={{ animationDelay: `${0.1 + i * 0.05}s` }}
                >
                  {post.coverImage && (
                    <div className="aspect-[2/1] w-full overflow-hidden bg-secondary/60">
                      <Image
                        src={post.coverImage}
                        alt={post.title}
                        width={1200}
                        height={600}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                      />
                    </div>
                  )}
                  <div className="p-6">
                    {post.category && (
                      <span className="inline-block rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                        {post.category}
                      </span>
                    )}
                    <h2
                      className={`font-display text-lg font-semibold text-foreground transition-colors group-hover:text-primary ${post.category ? "mt-2" : ""}`}
                    >
                      {post.title}
                    </h2>
                    {post.excerpt && (
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-2">
                        {post.excerpt}
                      </p>
                    )}
                    <div className="mt-4 flex items-center gap-2.5">
                      <AuthorAvatar
                        author={post.author}
                        authorImage={post.authorImage}
                        size={22}
                      />
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">
                          {post.author}
                        </span>
                        <span className="text-border">·</span>
                        <time dateTime={post.date}>
                          {new Date(post.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </time>
                        <span className="text-border">·</span>
                        <span>{post.readTime}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
