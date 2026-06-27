import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

interface EventState {
  eventId: string | null;
  shareToken: string | null;
  guestToken: string | null;
  guestId: string | null;
  guestName: string | null;
  eventTitle: string | null;
  eventStatus: "upcoming" | "live" | "ended" | null;
  hostId: string | null;
  isHost: boolean;
  eventHostName: string | null;
}

interface EventContextValue extends EventState {
  setEvent: (state: EventState) => void;
  clearEvent: () => void;
  updateStatus: (status: "upcoming" | "live" | "ended") => void;
  isLoaded: boolean;
}

const EMPTY_STATE: EventState = {
  eventId: null,
  shareToken: null,
  guestToken: null,
  guestId: null,
  guestName: null,
  eventTitle: null,
  eventStatus: null,
  hostId: null,
  isHost: false,
  eventHostName: null,
};

const STORAGE_KEY = "memento_event_state_v2";

const EventContext = createContext<EventContextValue>({
  ...EMPTY_STATE,
  setEvent: () => {},
  clearEvent: () => {},
  updateStatus: () => {},
  isLoaded: false,
});

export function EventProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EventState>(EMPTY_STATE);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          setState(JSON.parse(raw));
        } catch {}
      }
      setIsLoaded(true);
    });
  }, []);

  const setEvent = useCallback((newState: EventState) => {
    setState(newState);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
  }, []);

  const clearEvent = useCallback(() => {
    setState(EMPTY_STATE);
    AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const updateStatus = useCallback(
    (status: "upcoming" | "live" | "ended") => {
      setState((prev) => {
        const updated = { ...prev, eventStatus: status };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
    },
    []
  );

  return (
    <EventContext.Provider
      value={{ ...state, setEvent, clearEvent, updateStatus, isLoaded }}
    >
      {children}
    </EventContext.Provider>
  );
}

export function useEvent() {
  return useContext(EventContext);
}
