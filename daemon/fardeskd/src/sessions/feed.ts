// What a client sees for one session: transcript activities, then the broker's still-pending requests.
import type { Activity, ActivityDetail, ActivityPage } from "../contract/schema.js";
import type { Broker } from "../permissions/broker.js";
import { buildDetail, pageActivities } from "../transcript/index.js";
import type { PageOptions } from "../transcript/index.js";
import type { SessionStore } from "./store.js";

const PENDING = "pending";

export type DetailLimits = { maxOutputLines: number; maxDiffLines: number };

export function sessionFeed(store: SessionStore, broker: Pick<Broker, "activities">, sessionId: string): Activity[] {
  // The broker only ever holds permission and question activities, and both carry a `state`.
  const requests = broker.activities(sessionId) as Extract<Activity, { kind: "permission" | "question" }>[];
  const pending = requests.filter((activity) => activity.state === PENDING);
  return [...store.activities(sessionId), ...pending];
}

export function pagedFeed(
  store: SessionStore,
  broker: Pick<Broker, "activities">,
  sessionId: string,
  options: PageOptions,
): ActivityPage {
  return pageActivities(sessionFeed(store, broker, sessionId), options);
}

export function sessionDetail(
  store: SessionStore,
  sessionId: string,
  activityId: string,
  limits: DetailLimits,
): ActivityDetail {
  const { summary } = store.get(sessionId);
  return buildDetail(store.lines(sessionId), activityId, { cwd: summary.cwd, ...limits });
}
