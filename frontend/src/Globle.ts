const apiBaseFromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
const wsBaseFromEnv = import.meta.env.VITE_WS_BASE_URL as string | undefined;

export const API_BASE_URL = apiBaseFromEnv || "/api";

const defaultWsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const defaultWsBase = `${defaultWsProtocol}//${window.location.host}/ws`;

export const WS_BASE_URL = wsBaseFromEnv || defaultWsBase;
