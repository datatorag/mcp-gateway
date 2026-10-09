---
title: "We Stopped Building and Deploying on the Production Box"
excerpt: "Since the start, the server that runs DataToRAG also built every release of DataToRAG, from a git checkout sitting next to the secrets. Now GitHub builds the image, a person approves the deploy, and the box can do exactly one thing when asked: pull a named image and swap it in. Here is what we built, what we found on the way, and what we decided not to build."
date: "2026-10-09"
author: "Manuel Yang"
category: "Engineering"
coverImage: "/blog/deploys-off-the-box.png"
tags: ["engineering", "deploys", "github-actions", "docker", "security"]
---

Until this week, a deploy of DataToRAG went like this: SSH into the production box, pull the repo, run `docker compose up --build`, watch it. The box had the full git checkout, the build toolchain, the environment file with every production secret, and the Docker socket, all in one place and all reachable by the same login. It worked, and it is how most small products ship. It also meant the thing that builds the software and the thing that runs it were the same machine with the same keys.

The repo is public. That is the part that made me want to change it. The threat I care about is not our own agents or a mistake by me, it is someone outside: a pull request from a fork, a dependency that turns on us, a workflow edit on a branch. Every one of those should be able to reach, at most, a build. None of them should be able to reach the box.

## What a deploy is now

GitHub builds the image. A push to `main` that touches the gateway runs a build on a GitHub runner, publishes the image to the GitHub container registry under the commit's sha, and keeps a record of the digest it pushed. No mutable tag is ever deployed; the host runs a digest or nothing. The registry package is public, which sounds odd for a product but follows from the repo being public: the image holds what the repo holds plus a few build values that end up in the browser anyway, and a public package means the box needs no registry credential at all.

Before any of that, `main` is protected. Every pull request runs the gate (typecheck and tests for whatever surface changed) and a leak scan over the diff and the commit messages, and both are required checks. Merge commits only, no force push, no deletion, and it applies to admins too. Actions are GitHub's own, pinned by sha. A workflow from an outside contributor does not run until someone looks at it.

A merge does not deploy. A deploy is a separate workflow that someone dispatches for a named surface and a named commit. It resolves the commit to the digest from the build record, shows that exact request line, and then waits on a GitHub environment that a named person has to approve. That approval is honest about what it is: a record of who said yes and when, not a lock. The control is still a person saying go, in words, before production changes, same as it always was.

Once approved, the job sends one line over SSH to the box: surface, sha, digest. The login is a dedicated deploy user whose key is bound to a forced command. It cannot open a shell, cannot forward anything, cannot run anything except the host script, and the host script is the only thing its sudo rule names. The box holds no credential that can write to GitHub or to the registry.

The host script does not trust the request. It checks the commit is on `main` and newer than the one running, by asking GitHub's public API (no answer is a refusal). It pulls by digest, checks the image's revision label matches the commit, swaps the container in, and waits for health. If health does not come, it starts the image that was running before, on its own. If it does, it records the new commit as current and the old one as previous, and keeps the newest five images so a rollback works even if the registry is unreachable.

A rollback is the same workflow with a flag. The host puts back the image it recorded as previous, refuses if that is not the commit you named, pulls nothing, builds nothing. It needs the same approval because it is a deploy.

![A pull request into main, the build on GitHub by digest, a person's approval, one command to the box, pull, swap, health, put-back](/blog/deploys-off-the-box.png)

## The canary

I did not want the first run of any of this to be against the real gateway. So there is a second surface, a throwaway image a few megabytes in size whose only job is to answer with its own commit. It runs on the box with no published port, read-only, 64 MB, and it is the thing we deploy, roll back and deploy forward with when we want to prove the pipeline rather than ship anything.

That is how the pipeline was proven: canary deploy, canary rollback, canary deploy again, each one checked on the box afterwards, each one leaving the real gateway's start time untouched. Only then did the gateway get its first deploy through it, and that one was for a commit whose code differed from what was running by a comment and a handful of test files. The first time the new path touches production, it should be carrying nothing.

## What we found on the way

The gateway image was 4 GB on the box. The Dockerfile was single stage and shipped the source, the tests, the dev dependencies and the build cache. Hidden cost when you build on the host, a real cost when every deploy is a pull. A multi-stage build on a base pinned by digest cut it to 2 GB unpacked, 390 MB compressed from 735, and the pull from 65 seconds to 46.

The environment file lived in the git checkout, because that is where compose found it. Now it lives in a directory outside any checkout, with a small script that can render it from the parameter store without the repo being there at all. The old backup copies that had accumulated next to it are gone. Whether the checkout itself stays is the next question.

And one real bug, found by a review before it ever ran. If a deploy run was cancelled, or timed out, while the new container was failing its health check, the SSH connection closed, the script stopped at its next line of output, and that line sat between "the new image failed" and "put the old one back". The failed image would have stayed running. It was proven on real Docker with the installed script as the control, fixed so that a deploy that has started always finishes its put-back and its record, and the fixed script was installed before anyone had a reason to cancel a run. Until it was, the rule was simply never cancel a release mid-deploy.

## What it costs

About five seconds of outage per gateway deploy, measured from outside: the old container stops, the new one starts and answers health, and in between the edge returns an error. Sessions in flight are dropped, as they were before. One approval click per deploy. And it is slower than building on the box, a couple of minutes of runner time plus the pull, because a build on a GitHub runner is further from the Docker socket than a build next to it. I will take that.

## What we did not build

The plan this week had the plugins (the Google Workspace and Atlassian halves of the product) moving into their own containers with their own images and their own deploys. I stopped that. Nobody reaches a plugin except through the gateway, so there was no scaling argument. The two real gains, a crashing plugin restarting on its own and a plugin not seeing the gateway's keys, are worth having at ten plugins written by strangers. At two plugins of our own code they did not pay for per-plugin networks, a header-trust fix in the gateway, host firewall rules and two rollback ids per release. The plugins stay inside the gateway image: one image, one deploy, one rollback. Each plugin process will get only its own environment, which is the half of the secrets argument that costs nothing.

If a plugin ever misbehaves, moving it out is a small change, because the repo layout already treats it as its own package. That door stays open. I just did not want to walk through it for a problem I do not have.

## Still manual

Migrations. A person runs them from a checkout with the environment set, before the deploy that needs them, and the pipeline knows nothing about the database on purpose. That is the right place for it to stay for now, and it is the one step in a release where I still type.
