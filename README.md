# Spider Link Graph

Crawl websites and visualize internal link structure as an interactive force-directed graph using [Spider Cloud](https://spider.cloud) — the fastest web crawling infrastructure.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/spider-rs/spider-link-graph)

**Live Demo:** [https://link-graph.spider.cloud](https://link-graph.spider.cloud)

## Features

- Crawl any website using Spider Cloud API
- Real-time JSONL streaming results
- Supabase authentication (GitHub & Discord)
- Local IndexedDB storage for caching results
- Dark theme matching spider.cloud branding
- Configurable crawl settings (limit, format, request type)

## Getting Started

### Prerequisites

- Node.js 18+
- A [Spider Cloud](https://spider.cloud) account with API credits
- Supabase project for authentication

### Setup

1. Clone the repository:

```bash
git clone https://github.com/spider-rs/spider-link-graph.git
cd spider-link-graph
```

2. Install dependencies:

```bash
npm install
```

3. Configure environment variables:

```bash
cp .env.local .env
```

Edit `.env` and add your Supabase and Spider Cloud credentials:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_API_URL=https://api.spider.cloud
```

4. Run the development server:

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

## Tech Stack

- [Next.js 14](https://nextjs.org/) — React framework
- [Tailwind CSS](https://tailwindcss.com/) — Styling
- [shadcn/ui](https://ui.shadcn.com/) — UI components
- [Supabase](https://supabase.com/) — Authentication
- [Spider Cloud](https://spider.cloud) — Web crawling API

## License

[MIT](LICENSE)
