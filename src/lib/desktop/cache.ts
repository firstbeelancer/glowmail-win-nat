import { invoke } from "@tauri-apps/api/core";
import type { Email, Folder } from "@/types";

type DesktopBootstrap = {
  backendProvider: string;
  database: {
    path: string;
    provider: string;
    ftsEnabled: boolean;
  };
};

type CachedSearchResult = {
  emails: Email[];
  total: number;
  hasMore: boolean;
};

type FolderSyncState = {
  accountEmail: string;
  folderPath: string;
  lastUid?: number | null;
  lastSyncStartedAt?: string | null;
  lastSyncFinishedAt?: string | null;
  lastError?: string | null;
};

let desktopBootstrapPromise: Promise<DesktopBootstrap | null> | null = null;

async function safeInvoke<T>(command: string, payload?: Record<string, unknown>): Promise<T | null> {
  try {
    return await invoke<T>(command, payload);
  } catch {
    return null;
  }
}

export async function getDesktopBootstrap(): Promise<DesktopBootstrap | null> {
  if (!desktopBootstrapPromise) {
    desktopBootstrapPromise = safeInvoke<DesktopBootstrap>("get_desktop_bootstrap");
  }

  return desktopBootstrapPromise;
}

export async function isDesktopRuntime(): Promise<boolean> {
  const bootstrap = await getDesktopBootstrap();
  return !!bootstrap;
}

export async function cacheFolders(accountEmail: string, folders: Folder[]): Promise<void> {
  await safeInvoke("cache_upsert_folders", {
    request: {
      accountEmail,
      folders,
    },
  });
}

export async function getCachedFolders(accountEmail: string): Promise<Folder[]> {
  return (await safeInvoke<Folder[]>("cache_get_folders", {
    accountEmail,
  })) || [];
}

export async function cacheEmails(accountEmail: string, folderPath: string, emails: Email[]): Promise<void> {
  await safeInvoke("cache_upsert_emails", {
    request: {
      accountEmail,
      folderPath,
      emails,
    },
  });
}

export async function removeCachedEmail(
  accountEmail: string,
  folderPath: string,
  emailId: string,
): Promise<void> {
  await safeInvoke("cache_delete_email", {
    request: {
      accountEmail,
      folderPath,
      emailId,
    },
  });
}

export async function getCachedFolderEmails(
  accountEmail: string,
  folderPath: string,
  limit: number,
  offset = 0,
): Promise<Email[]> {
  return (await safeInvoke<Email[]>("cache_get_folder_emails", {
    accountEmail,
    folderPath,
    limit,
    offset,
  })) || [];
}

export async function getCachedEmailDetail(
  accountEmail: string,
  folderPath: string,
  emailId: string,
): Promise<Email | null> {
  return (await safeInvoke<Email>("cache_get_email_detail", {
    request: {
      accountEmail,
      folderPath,
      emailId,
    },
  })) || null;
}

export async function searchCachedEmails(
  accountEmail: string,
  folderPath: string,
  query: string,
  limit: number,
  offset = 0,
): Promise<CachedSearchResult> {
  return (
    (await safeInvoke<CachedSearchResult>("cache_search_emails", {
      request: {
        accountEmail,
        folderPath,
        query,
        limit,
        offset,
      },
    })) || {
      emails: [],
      total: 0,
      hasMore: false,
    }
  );
}

export async function markFolderSyncStarted(
  accountEmail: string,
  folderPath: string,
  lastUid?: number | null,
): Promise<void> {
  await safeInvoke("cache_mark_folder_sync_started", {
    request: {
      accountEmail,
      folderPath,
      lastUid: lastUid ?? null,
      lastError: null,
    },
  });
}

export async function markFolderSyncFinished(
  accountEmail: string,
  folderPath: string,
  lastUid?: number | null,
  lastError?: string | null,
): Promise<void> {
  await safeInvoke("cache_mark_folder_sync_finished", {
    request: {
      accountEmail,
      folderPath,
      lastUid: lastUid ?? null,
      lastError: lastError ?? null,
    },
  });
}

export async function getFolderSyncStates(accountEmail: string): Promise<FolderSyncState[]> {
  return (await safeInvoke<FolderSyncState[]>("cache_get_folder_sync_states", {
    accountEmail,
  })) || [];
}
