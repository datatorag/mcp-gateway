import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AddToAgent } from "@/components/add-to-agent";
import Link from "next/link";
import Image from "next/image";
import {
  getAllPosts,
  getPostBySlug,
  getRelatedPosts,
  postModified,
  postSearchDescription,
  postSearchTitle,
  postUrl,
  type BlogPost,
} from "@/lib/blog";
import { SITE_NAME, SITE_URL, blogPostingNode, breadcrumbNode, faqPageNode } from "@/lib/site-schema";
import { Navbar } from "@/components/navbar";
import { FaqSection } from "@/components/faq-section";
import { JsonLd } from "@/components/json-ld";
import { PostCover } from "@/components/post-cover";
import { formatContentDate } from "@/lib/utils";
import { SOCIAL_CARD, SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "@/lib/social-card";
import { markdownUrl } from "@/lib/markdown-copies";
import { BLOG_FEED_URL } from "@/lib/blog-feed";
import { afterEditedDate, editNoteHtml, splitEditNote } from "@/lib/edit-note";
import { BLOG_FEED_TYPE, BLOG_PATH } from "../copy";
import { postCardImage } from "@/lib/post-card-image";
import { splitDemoMarkers } from "@/lib/demo-embed";
import { DemoEmbed, EMBEDDABLE_DEMO_IDS } from "@/components/demo/demo-embed";
import { signInHref } from "@/lib/sign-in";

/** Where a post's edit note sits on its page, for the link beside the date. */
const EDIT_NOTE_ID = "edit-note";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

/** The absolute URL of the picture named in the article's structured data:
 * the post's own image, whatever its shape, and the site's card for a post
 * with none, so every post's markup carries a picture. */
function postImageUrl(post: { ogImage?: string; coverImage?: string }): string {
  const imagePath = post.ogImage ?? post.coverImage;
  return imagePath ? new URL(imagePath, SITE_URL).toString() : SOCIAL_CARD.url;
}

/**
 * The note at the end of an edited post. Two tiers, decided by the post:
 * an edit that changed what the post says wrote `updatedNote`, and the note
 * shows; any other edit shows only its day, in the date line.
 *
 * The note's newest entry is shown in full, after the one "Edited <day>"
 * the box prints (an entry opening with that same day gives it up, so the
 * day is not printed twice). Every earlier entry is inside a `<details>`,
 * in the page as served and opened without a script.
 */
function EditNote({ post }: { post: BlogPost }) {
  if (!post.updated || !post.updatedNote) return null;
  const [latest, ...earlier] = splitEditNote(post.updatedNote);
  if (!latest) return null;
  const shown = formatContentDate(post.updated);
  return (
    <div
      id={EDIT_NOTE_ID}
      className="mt-10 scroll-mt-28 rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground"
    >
      <p data-edit-latest="">
        <span className="font-medium text-foreground">
          Edited <time dateTime={post.updated}>{shown}</time>
        </span>
        <span dangerouslySetInnerHTML={{ __html: editNoteHtml(afterEditedDate(latest, shown)) }} />
      </p>
      {earlier.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer font-medium text-foreground">
            Earlier edits
          </summary>
          <ul className="mt-2 space-y-2">
            {earlier.map((entry, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: editNoteHtml(entry.text) }} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Not Found" };
  // The post's own picture when it is fit for a preview (post-card-image.ts);
  // otherwise the keys are left out below and the site-wide card, spread in
  // first, stands (SCRUM-367).
  const card = postCardImage(post);
  const images = card ? { images: [{ ...card, alt: post.title }] } : {};

  // What a search result and a link preview show: the post's search title
  // and description when it wrote them, else what it always sent. The
  // heading on the page stays the post's own headline.
  const description = postSearchDescription(post);
  const shareTitle = post.searchTitle ?? post.title;

  return {
    title: postSearchTitle(post),
    description,
    authors: [{ name: post.author }],
    alternates: {
      canonical: postUrl(slug),
      types: { "text/markdown": markdownUrl(`${BLOG_PATH}/${slug}`), [BLOG_FEED_TYPE]: BLOG_FEED_URL },
    },
    openGraph: {
      ...SOCIAL_OPEN_GRAPH,
      title: shareTitle,
      description,
      type: "article",
      publishedTime: post.date,
      ...(post.updated ? { modifiedTime: post.updated } : {}),
      authors: [post.author],
      url: postUrl(slug),
      ...images,
    },
    twitter: {
      ...SOCIAL_TWITTER,
      title: shareTitle,
      description,
      ...images,
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

  const url = postUrl(slug);
  const jsonLd = [
    blogPostingNode({
      headline: post.title,
      description: postSearchDescription(post),
      url,
      datePublished: post.date,
      dateModified: postModified(post),
      image: postImageUrl(post),
      keywords: post.tags,
      section: post.category,
      author: { name: post.author, image: post.authorImage ? `${SITE_URL}${post.authorImage}` : undefined },
    }),
    // FAQPage, when the post authored questions. Built by `faqPageNode` rather
    // than inlined, because docs emit the same node and two hand-written copies
    // of one projection is how they drift. That module carries the standing
    // caveat: the rich result is retired, this has NO VERIFIED CONSUMER, and the
    // on-page block below is the half that actually pays.
    ...(post.faqs.length > 0 ? [faqPageNode(post.faqs)] : []),
    breadcrumbNode([
      { name: SITE_NAME, url: SITE_URL },
      { name: "Blog", url: `${SITE_URL}${BLOG_PATH}` },
      { name: post.title, url },
    ]),
  ];

  return (
    <>
      <Navbar />
      <main className="flex-1">
        <article className="mx-auto max-w-3xl px-6 pb-12 pt-28 sm:pb-16 sm:pt-32">
          <JsonLd nodes={jsonLd} />

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
                {/* Every edited post says so here, with the day the
                    structured data states as its modified date. A post with
                    a note links to it; the note itself is after the body, so
                    a post opens with its own words. */}
                {post.updated && (
                  <>
                    <span className="text-border">·</span>
                    {post.updatedNote ? (
                      <a href={`#${EDIT_NOTE_ID}`} data-edited="" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
                        Edited <time dateTime={post.updated}>{formatContentDate(post.updated)}</time>
                      </a>
                    ) : (
                      <span data-edited="" className="text-muted-foreground">
                        Edited <time dateTime={post.updated}>{formatContentDate(post.updated)}</time>
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </header>

          <PostCover post={post} />

          {/* A post may carry `<!-- demo:<id> -->` on its own line; the page
              puts that scripted demo there (lib/demo-embed.ts). A post with
              no marker is one segment and renders as the single prose block
              it always was. */}
          {splitDemoMarkers(post.html, EMBEDDABLE_DEMO_IDS).map((segment, i) =>
            segment.kind === "demo" ? (
              <DemoEmbed id={segment.id} key={`demo-${i}`} />
            ) : (
              <div
                className={i === 0 ? "prose mt-10" : "prose"}
                dangerouslySetInnerHTML={{ __html: segment.html }}
                key={`html-${i}`}
              />
            )
          )}

          {/* A note only when there is something to disclose: `updated`
              alone moves the stated date and shows the day above, while
              `updatedNote` marks a correction worth a reader-facing note.
              It sits at the end of the body, not above it: above, the note
              was the first thing a reader, or a program quoting the post,
              met. */}
          <EditNote post={post} />

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

          {/* Placed after the article body and before the CTA, so it reads as
              part of the article rather than as part of the pitch. */}
          <FaqSection faqs={post.faqs} />

          {/* SCRUM-503: the client step, before the pitch, for a reader who
              already has an agent. */}
          <AddToAgent placement="blog" layout="compact" className="mt-12" />

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
              <a
                href={signInHref()}
                className="rounded-[var(--radius)] bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90"
              >
                Start free
              </a>
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
