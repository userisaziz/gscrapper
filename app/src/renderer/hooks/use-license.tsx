import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api, onEvent, type LicenseResponse } from "@/lib/wails";

type LicenseState =
  | { status: "checking" }
  | { status: "unauthenticated"; expired?: boolean }
  | { status: "authenticated"; license: LicenseResponse };

interface LicenseContextValue {
  state: LicenseState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LicenseState>({ status: "checking" });

  // Check license on startup
  useEffect(() => {
    // Dev-only bypass: when running in a plain browser (no Electron preload
    // bridge), skip auth so the UI can be previewed via `npx vite`.
    if (import.meta.env.DEV && !(window as any).api) {
      setState({
        status: "authenticated",
        license: {
          valid: true,
          email: "dev@localhost",
          plan: "dev",
          expires_at: "2099-12-31",
          days_left: 9999,
        },
      });
      return;
    }
    let cancelled = false;
    api
      .checkLicense()
      .then((result) => {
        if (cancelled) return;
        if (result?.valid) {
          setState({ status: "authenticated", license: result });
        } else {
          setState({
            status: "unauthenticated",
            expired: result?.error?.includes("expired") ?? false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unauthenticated" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for license expiry events from the Go side
  useEffect(() => {
    return onEvent("license:expired", () => {
      setState({ status: "unauthenticated", expired: true });
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    if (result?.valid) {
      setState({ status: "authenticated", license: result });
    } else {
      const expired = result?.error?.includes("expired") ?? false;
      setState({ status: "unauthenticated", expired });
      throw new Error(result?.error || "Login failed.");
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // best-effort
    }
    setState({ status: "unauthenticated" });
  }, []);

  return (
    <LicenseContext.Provider value={{ state, login, logout }}>
      {children}
    </LicenseContext.Provider>
  );
}

export function useLicense() {
  const ctx = useContext(LicenseContext);
  if (!ctx) throw new Error("useLicense must be used within LicenseProvider");
  return ctx;
}
