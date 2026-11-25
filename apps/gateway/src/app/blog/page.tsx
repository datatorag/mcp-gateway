import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getAllPosts, getPillarPosts, postUrl } from "@/lib/blog";
import { BLOG_FEED_URL } from "@/lib/blog-feed";
import { Navbar } from "@/components/navbar";
import { JsonLd } from "@/components/json-ld";
import { SITE_NAME, SITE_URL, blogIndexNode, breadcrumbNode } from "@/lib/site-schema";
import { SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import { BLOG_DESCRIPTION, BLOG_FEED_TYPE, BLOG_HEADING, BLOG_PATH, BLOG_SEARCH_TITLE } from "./copy";

const BLOG_URL = `${SITE_URL}${BLOG_PATH}`;

export const metadata: Metadata = {
  title: BLOG_SEARCH_TITLE,
  description: BLOG_DESCRIPTION,
  alternates: { canonical: BLOG_URL, types: { [BLOG_FEED_TYPE]: BLOG_FEED_URL } },
  twitter: { ...SOCIAL_TWITTER, title: BLOG_SEARCH_TITLE, description: BLOG_DESCRIPTION },
  openGraph: {
    ...SOCIAL_OPEN_GRAPH,
    title: BLOG_SEARCH_TITLE,
    description: BLOG_DESCRIPTION,
    type: "website",
    url: BLOG_URL,
  },
};

/** How wide a card's picture is drawn: one, two, or three columns. */
const CARD_SIZES = "(min-width: 1024px) 352px, (min-width: 640px) 50vw, 100vw";

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
  // The main post of each topic, listed first. Nothing renders until a post
  // sets `pillar` in its frontmatter.
  const pillars = getPillarPosts();
  const jsonLd = [
    blogIndexNode({
      name: BLOG_HEADING,
      description: BLOG_DESCRIPTION,
      url: BLOG_URL,
      posts: posts.map((p) => ({ name: p.title, url: postUrl(p.slug) })),
    }),
    breadcrumbNode([
      { name: SITE_NAME, url: SITE_URL },
      { name: "Blog", url: BLOG_URL },
    ]),
  ];

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 pb-16 pt-32 sm:pb-20 sm:pt-36">
          <JsonLd nodes={jsonLd} />
          <div className="animate-fade-in-up">
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {BLOG_HEADING}
            </h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              {BLOG_DESCRIPTION}
            </p>
          </div>

          {pillars.length > 0 && (
            <section aria-labelledby="start-here" className="mt-10 rounded-2xl border border-border bg-secondary/30 p-6">
              <h2 id="start-here" className="font-display text-lg font-semibold text-foreground">
                Start here
              </h2>
              <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                {pillars.map((post) => (
                  <li key={post.slug}>
                    <Link
                      href={`/blog/${post.slug}`}
                      className="text-sm font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
                    >
                      {post.title}
                    </Link>
                    {post.excerpt && (
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{post.excerpt}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {posts.length === 0 ? (
            <p className="mt-16 text-center text-muted-foreground">
              Articles coming soon.
            </p>
          ) : (
            <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
                        sizes={CARD_SIZES}
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
                          {new Date(`${post.date}T00:00:00`).toLocaleDateString("en-US", {
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
