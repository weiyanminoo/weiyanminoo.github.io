---
project: seon
title: Building Seon
dek: A dating bot that skips the small talk, and what I learned when the hard part wasn't the code.
---

## Tired of the apps

You probably know how it goes. You swipe for a while and get a match. You text for a week, maybe two. Then the chat quietly dies, or you finally meet and they look nothing like their photos.

I realised a lot of fresh grads and people in their twenties and early thirties were going through exactly this. They had dating fatigue. Lots of swiping, lots of texting, and no promise of an actual date at the end of it. My team came up with the idea for Seon to fix that, and I made the product decisions and built it.

## Skip the text. Meet next.

That was Seon in five words. It's a Telegram bot, and each part of it takes on one of those problems.

- **No swiping.** There's no feed and no algorithm. A matchmaker picks every match by hand, and new ones drop once a week.
- **No endless texting.** Matches can't chat at all. If you both like each other, you pick a weekend brunch slot that suits you both, and that's your date.
- **No flaking.** To lock it in, you put down a $20 deposit through PayNow. It covers your coffee and a dessert. It also makes ghosting a lot less tempting.
- **No catfishing.** You sign up with LinkedIn or your work email, record a short video of yourself, and we check it by hand before you can go any further.

## The video bubble

Telegram has these little round video messages, which we called bubbles. We asked everyone to record one with their face and a quick intro, at least 10 seconds long. When you get a match, their bubble is the first thing you see.

It started out optional. After 20 user interviews, I made it mandatory. That came at a price. We lost 30% of profile completions, which hurts a little when you're small. But successful matches went up by 50%. Fewer people made it through the door, and the ones who did matched a lot better.

## Building it

I built Seon on my own over about two months. The bot is written in Python with python-telegram-bot. Supabase holds the database and keeps the videos in private storage. It all runs on Vercel, with a daily job that sends people nudges. My team worked from a Django admin, behind two-factor login, where they verified videos and made the matches. Two small side bots posted team updates and crash logs into our chats, so nothing broke quietly. Every change went through linting, a security scan and tests before it shipped.

Then there was the upload problem. Vercel cuts off a request after 10 seconds, and the shortest video we accepted was, of course, 10 seconds. So I moved uploads over to a Supabase Edge Function, where they have more time to finish.

## What happened

People found Seon interesting. But it didn't take off, and that came down to how we handled distribution and marketing.

Most of our users found us through Telegram channels. Our Instagram and TikTok barely moved. We also did most of our marketing after the product was ready, which, looking back, was the wrong way round.

## What I'd do differently

Distribution is the big lesson for me. If I ran Seon again, I'd:

- **Start on day one.** We could have started marketing the moment we had the idea. That's at least a month of building hype before launch, instead of launching to a quiet room.
- **Go guerrilla.** Post in Singapore subreddits, and partner with other startups and events to get in front of their crowds.
- **Work with creators.** Put real money into UGC with established creators to spread the word.

Building the product was the part I knew how to do. Getting people to use it turned out to be just as much work, and it needs to start just as early. That's the part I'll plan first next time.
