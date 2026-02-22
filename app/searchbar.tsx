"use client";

import React, { Dispatch, SyntheticEvent, useRef, useState } from "react";
import { VscLoading, VscSearch, VscSettings } from "react-icons/vsc";
import ms from "ms";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogOverlay,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import AuthDropdown, { useAuthMenu, supabase } from "./auth";
import { savePages } from "@/lib/storage";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3031";

const SearchBar = ({
  setDataValues,
  onSaveComplete,
}: {
  setDataValues: Dispatch<any>;
  onSaveComplete?: () => void;
}) => {
  const [url, setURl] = useState("");
  const [dataLoading, setDataLoading] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [crawlLimit, setCrawlLimit] = useState(50);
  const [returnFormat, setReturnFormat] = useState("raw");
  const [apiKey, setAPIKey] = useState("");
  const [request, setRequest] = useState("http");
  const crawledPagesRef = useRef<any[]>([]);
  const streamBufferRef = useRef("");
  const auth = useAuthMenu();
  const { toast } = useToast();

  const onAPIEvent = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const jwt = auth.$session?.access_token;
    if (!jwt) {
      return toast({ title: "Authentication Required", description: "Please login or register." });
    }
    if (!url) {
      return toast({ title: "URL Required", description: "Please enter a valid website url." });
    }
    const urlList = url.trim().split(",").map((item) =>
      item.startsWith("http://") || item.startsWith("https://") ? item.trim() : `https://${item.trim()}`
    ).filter(Boolean);
    setDataLoading(true);
    crawledPagesRef.current = [];
    streamBufferRef.current = "";
    const current = performance.now();
    let pages = 0;
    let finished = false;
    toast({ title: "Crawling", description: `Crawling ${urlList.length} website${urlList.length === 1 ? "" : "s"}.` });
    try {
      const res = await fetch(API_URL + "/crawl", {
        method: "POST",
        body: JSON.stringify({ url: urlList.join(","), limit: crawlLimit, return_format: returnFormat, request }),
        headers: { "content-type": "application/jsonl", authorization: apiKey || jwt },
      });
      if (res.ok) {
        finished = true;
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (streamBufferRef.current.trim()) {
                try { const p = JSON.parse(streamBufferRef.current.trim()); crawledPagesRef.current.push(p); pages++; setDataValues((prev: any) => prev ? [...prev, p] : [p]); } catch {}
              }
              break;
            }
            streamBufferRef.current += decoder.decode(value, { stream: true });
            const lines = streamBufferRef.current.split("\n");
            streamBufferRef.current = lines.pop() || "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try { const parsed = JSON.parse(trimmed); crawledPagesRef.current.push(parsed); pages++; setDataValues((prev: any) => prev ? [...prev, parsed] : [parsed]); } catch {}
            }
          }
        }
      }
    } catch (e) { console.error(e); } finally {
      setDataLoading(false);
      streamBufferRef.current = "";
      if (finished) {
        toast({ title: "Crawl finished", description: `Took ${ms(performance.now() - current, { long: true })} for ${pages} page${pages === 1 ? "" : "s"}.` });
        if (crawledPagesRef.current.length) {
          savePages(crawledPagesRef.current).then(() => onSaveComplete?.()).catch(console.error);
        }
      }
      crawledPagesRef.current = [];
    }
  };

  return (
    <>
      <nav className="flex items-center gap-2 py-2 px-3 border-b flex-wrap">
        <div className="flex gap-3 items-center shrink-0">
          <svg height={24} width={24} viewBox="0 0 36 34" xmlns="http://www.w3.org/2000/svg" className="fill-[#3bde77] shrink-0">
            <title>Spider</title>
            <path fillRule="evenodd" clipRule="evenodd" d="M9.13883 7.06589V0.164429L13.0938 0.164429V6.175L14.5178 7.4346C15.577 6.68656 16.7337 6.27495 17.945 6.27495C19.1731 6.27495 20.3451 6.69807 21.4163 7.46593L22.8757 6.175V0.164429L26.8307 0.164429V7.06589V7.95679L26.1634 8.54706L24.0775 10.3922C24.3436 10.8108 24.5958 11.2563 24.8327 11.7262L26.0467 11.4215L28.6971 8.08749L31.793 10.5487L28.7257 14.407L28.3089 14.9313L27.6592 15.0944L26.2418 15.4502C26.3124 15.7082 26.3793 15.9701 26.4422 16.2355L28.653 16.6566L29.092 16.7402L29.4524 17.0045L35.3849 21.355L33.0461 24.5444L27.474 20.4581L27.0719 20.3816C27.1214 21.0613 27.147 21.7543 27.147 22.4577C27.147 22.5398 27.1466 22.6214 27.1459 22.7024L29.5889 23.7911L30.3219 24.1177L30.62 24.8629L33.6873 32.5312L30.0152 34L27.246 27.0769L26.7298 26.8469C25.5612 32.2432 22.0701 33.8808 17.945 33.8808C13.8382 33.8808 10.3598 32.2577 9.17593 26.9185L8.82034 27.0769L6.05109 34L2.37897 32.5312L5.44629 24.8629L5.74435 24.1177L6.47743 23.7911L8.74487 22.7806C8.74366 22.6739 8.74305 22.5663 8.74305 22.4577C8.74305 21.7616 8.76804 21.0758 8.81654 20.4028L8.52606 20.4581L2.95395 24.5444L0.615112 21.355L6.54761 17.0045L6.908 16.7402L7.34701 16.6566L9.44264 16.2575C9.50917 15.9756 9.5801 15.6978 9.65528 15.4242L8.34123 15.0944L7.69155 14.9313L7.27471 14.407L4.20739 10.5487L7.30328 8.08749L9.95376 11.4215L11.0697 11.7016C11.3115 11.2239 11.5692 10.7716 11.8412 10.3473L9.80612 8.54706L9.13883 7.95679V7.06589Z" />
          </svg>
          <h1 className="text-sm md:text-base font-semibold truncate">Spider Link Graph</h1>
        </div>
        <form className="flex items-center gap-2 flex-1 min-w-0 justify-end" onSubmit={onAPIEvent} noValidate>
          <div className="relative w-full max-w-xs">
            <Label htmlFor="website-form" className="sr-only">Crawl Website</Label>
            <Input type="text" id="website-form" className="rounded border px-3 py-1.5 pr-9 text-sm w-full" placeholder="Enter website..." onChange={(e) => setURl(e.currentTarget.value)} />
            <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none">
              {dataLoading ? <VscLoading className="motion-safe:animate-spin w-4 h-4" /> : <VscSearch className="w-4 h-4" />}
            </div>
          </div>
          {auth?.$session ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfigModalOpen(true)} className="p-1.5 rounded shrink-0">
              <VscSettings className="w-5 h-5" />
            </Button>
          ) : null}
        </form>
        <AuthDropdown {...auth} />
      </nav>
      {configModalOpen && (
        <Dialog open={configModalOpen} onOpenChange={setConfigModalOpen}>
          <DialogOverlay />
          <DialogContent className="p-4 rounded-md shadow-md">
            <DialogHeader>
              <DialogTitle>Configuration</DialogTitle>
              <DialogDescription>Set your crawl options.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div className="flex items-center">
                <Label htmlFor="crawlLimit" className="flex-1">Crawl Limit:</Label>
                <Input type="number" id="crawlLimit" className="w-1/2" value={crawlLimit} onChange={(e) => setCrawlLimit(Number(e.currentTarget.value))} min="1" max="1000" />
              </div>
              <div className="flex items-center">
                <Label className="flex-1">Return Format:</Label>
                <Select onValueChange={setReturnFormat} defaultValue={returnFormat}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="raw">Raw</SelectItem>
                    <SelectItem value="markdown">Markdown</SelectItem>
                    <SelectItem value="text">Text</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center">
                <Label className="flex-1">Request:</Label>
                <Select onValueChange={setRequest} defaultValue={request}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http">HTTP</SelectItem>
                    <SelectItem value="chrome">Chrome</SelectItem>
                    <SelectItem value="smart">Smart Mode</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="sk-key">API Key</Label>
                <Input placeholder="sk-somesecret" id="sk-key" onChange={(e) => setAPIKey(e.currentTarget.value)} />
                <p className="py-2 text-sm text-muted-foreground">This key is only used in the current session.</p>
              </div>
              <Button type="button" onClick={() => setConfigModalOpen(false)} className="self-end">Save</Button>
              <div className="pt-10 pb-2 flex place-content-end border-t">
                <Button onClick={async () => { await supabase.auth.signOut(); setConfigModalOpen(false); }} variant="destructive">Logout</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default SearchBar;
