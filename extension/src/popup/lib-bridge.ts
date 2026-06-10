import type { RequestMessage, ResponseFor } from "../lib/types";

export function sendMessage<M extends RequestMessage>(
  message: M,
): Promise<ResponseFor<M>> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(response as ResponseFor<M>);
    });
  });
}

export async function getActiveTab(): Promise<{ title: string; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return { title: tab?.title ?? "", url: tab?.url ?? "" };
}
