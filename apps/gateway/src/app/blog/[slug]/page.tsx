import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  faqAnchor,
  faqAnswerHtml,
  faqAnswerText,
  getAllPosts,
  getPostBySlug,
  getRelatedPosts,
} from "@/lib/blog";
import { Navbar } from "@/components/navbar";
import { ZoomableImage } from "@/components/zoomable-image";
import { formatContentDate } from "@/lib/utils";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Not Found" };

  return {
    title: `${post.title} | DataToRAG`,
    description: post.excerpt,
    authors: [{ name: post.author }],
    alternates: { canonical: `https://datatorag.com/blog/${slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.date,
      ...(post.updated ? { modifiedTime: post.updated } : {}),
      authors: [post.author],
      url: `https://datatorag.com/blog/${slug}`,
      ...(post.ogImage ? { images: [{ url: post.ogImage }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.excerpt,
    },
  };
}

function AuthorAvatar({
  author,
  authorImage,
}: {
  author: string;
  authorImage?: string;
}) {
  if (authorImage) {
    return (
      <Image
        src={authorImage}
        alt={author}
        width={32}
        height={32}
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
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
      {initials}
    </div>
  );
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const postUrl = `https://datatorag.com/blog/${slug}`;
  const imagePath = post.ogImage ?? post.coverImage;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.excerpt,
      datePublished: post.date,
      dateModified: post.updated ?? post.date,
      inLanguage: "en",
      isAccessibleForFree: true,
      url: postUrl,
      ...(imagePath ? { image: `https://datatorag.com${imagePath}` } : {}),
      ...(post.tags.length > 0 ? { keywords: post.tags.join(", ") } : {}),
      ...(post.category ? { articleSection: post.category } : {}),
      author: {
        "@type": "Person",
        name: post.author,
        ...(post.authorImage
          ? { image: `https://datatorag.com${post.authorImage}` }
          : {}),
      },
      publisher: {
        "@type": "Organization",
        name: "DataToRAG",
        url: "https://datatorag.com",
        logo: {
          "@type": "ImageObject",
          url: "https://datatorag.com/datatorag-logo-256.png",
        },
      },
      mainEntityOfPage: { "@type": "WebPage", "@id": postUrl },
    },
    // FAQPage, when the post authored questions. Google RETIRED the FAQ rich
    // result for every site on 2026-05-07 and deleted the documentation on
    // 2026-06-15, so this earns no Google search appearance and nothing should
    // ever claim it does. It ships because it is ten lines and makes content we
    // already publish unambiguous to anything that reads structured data. That
    // is a bet on a mechanism with NO VERIFIED CONSUMER: the on-page block below
    // is what actually pays, and it is the half to protect in any future edit.
    ...(post.faqs.length > 0
      ? [
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: post.faqs.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: {
                "@type": "Answer",
                text: faqAnswerText(f.a),
              },
            })),
          },
        ]
      : []),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Blog",
          item: "https://datatorag.com/blog",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: post.title,
          item: postUrl,
        },
      ],
    },
  ];

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <article className="mx-auto max-w-2xl px-6 pb-12 pt-28 sm:pb-16 sm:pt-32">
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
          />

          <Link
            href="/blog"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 12L6 8l4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Blog
          </Link>

          <header className="mt-8">
            {post.category && (
              <span className="inline-block rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                {post.category}
              </span>
            )}
            <h1
              className={`font-display text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-3xl ${post.category ? "mt-3" : ""}`}
            >
              {post.title}
            </h1>

            <div className="mt-5 flex items-center gap-3">
              <AuthorAvatar
                author={post.author}
                authorImage={post.authorImage}
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className="font-medium text-foreground">
                  {post.author}
                </span>
                <span className="text-border">·</span>
                <time
                  dateTime={post.date}
                  className="text-muted-foreground"
                >
                  {formatContentDate(post.date)}
                </time>
                <span className="text-border">·</span>
                <span className="text-muted-foreground">{post.readTime}</span>
              </div>
            </div>
          </header>

          {/* Visible disclosure only when there is something to disclose:
              `updated` alone still feeds dateModified/modifiedTime for
              trivial edits, while `updatedNote` marks a correction worth a
              reader-facing note. Edit notes mean less when spent on nothing. */}
          {post.updated && post.updatedNote && (
            <div className="mt-6 rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Edited{" "}
                <time dateTime={post.updated}>
                  {formatContentDate(post.updated)}
                </time>
              </span>
              {post.updatedNote && <>: {post.updatedNote}</>}
            </div>
          )}

          {post.coverImage && (
            <div className="mt-8 overflow-hidden rounded-2xl border border-border">
              <ZoomableImage
                src={post.coverImage}
                alt={post.title}
                width={1200}
                height={630}
                className="w-full"
                priority
              />
            </div>
          )}

          <div
            className="prose mt-10"
            dangerouslySetInnerHTML={{ __html: post.html }}
          />

          {post.tags.length > 0 && (
            <div className="mt-10 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Per-post FAQ. Deliberately NOT an accordion: collapsed text is
              worse to extract from and the block is short. Questions are real
              headings so a reader parsing document structure finds them as
              questions, and each carries an id plus scroll-mt-28 so a deep link
              is not hidden under the fixed navbar. */}
          {post.faqs.length > 0 && (
            <section className="mt-12 border-t border-border pt-10">
              <h2 className="font-display text-lg font-bold text-foreground">
                Frequently asked questions
              </h2>
              <div className="mt-6 space-y-7">
                {post.faqs.map((faq) => {
                  const anchor = faqAnchor(faq.q);
                  return (
                    <div key={anchor} id={anchor} className="scroll-mt-28">
                      <h3 className="group text-sm font-semibold text-foreground">
                        {faq.q}{" "}
                        <a
                          href={`#${anchor}`}
                          className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`Link to: ${faq.q}`}
                        >
                          #
                        </a>
                      </h3>
                      <div
                        className="mt-2 text-sm leading-relaxed text-muted-foreground [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-foreground [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs"
                        dangerouslySetInnerHTML={{
                          __html: faqAnswerHtml(faq.a),
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* CTA — appears on every post */}
          <div className="mt-12 rounded-2xl border border-border bg-secondary/30 p-8 text-center">
            <h2 className="font-display text-xl font-bold text-foreground">
              Ready to connect your data to AI?
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Give Claude write access to your Google Workspace. Start free, or
              talk to us about your setup.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/auth/login"
                className="rounded-[var(--radius)] bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
              >
                Start free
              </Link>
              <Link
                href="/contact"
                className="rounded-[var(--radius)] border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-secondary/50"
              >
                Contact us
              </Link>
            </div>
          </div>

          {(() => {
            const related = getRelatedPosts(slug);
            if (related.length === 0) return null;
            return (
              <div className="mt-12 border-t border-border pt-10">
                <h2 className="font-display text-lg font-bold text-foreground">
                  Related articles
                </h2>
                <div className="mt-5 space-y-4">
                  {related.map((r) => (
                    <Link
                      key={r.slug}
                      href={`/blog/${r.slug}`}
                      className="block rounded-xl border border-border p-4 transition-colors hover:border-primary/30 hover:bg-secondary/50"
                    >
                      <span className="text-sm font-medium text-foreground">
                        {r.title}
                      </span>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {r.excerpt}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })()}
        </article>
      </main>
    </>
  );
}
