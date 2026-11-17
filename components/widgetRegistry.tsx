"use client";

// Every widget type and the component that draws it, in one place: the grid
// (components/WidgetGrid.tsx) and the single-widget page (app/embed) both
// render widgets through renderWidget, so a widget added here appears in both.
import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import type { Widget, WidgetType } from "@/lib/widgets";
import WidgetCard from "./WidgetCard";
import NotebookWidget from "./NotepadWidget";
import TextWidget from "./TextWidget";
import RssWidget from "./RssWidget";
import RedditWidget from "./RedditWidget";
import YoutubeWidget from "./YoutubeWidget";
import F1Widget from "./F1Widget";
import ArxivWidget from "./ArxivWidget";
import HuggingFaceWidget from "./HuggingFaceWidget";
import TrackerWidget from "./TrackerWidget";
import RhythmWidget from "./RhythmWidget";
import UpkeepWidget from "./UpkeepWidget";
import DeficitWidget from "./DeficitWidget";
import BookmarksWidget from "./BookmarksWidget";
import TypingWidget from "./TypingWidget";
import ChatWidget from "./ChatWidget";
import KiwixWidget from "./KiwixWidget";
import AnytypeWidget from "./AnytypeWidget";
import WeatherWidget from "./WeatherWidget";
import CalendarWidget from "./CalendarWidget";
import ScheduleWidget from "./ScheduleWidget";
import SearchWidget from "./SearchWidget";
import TodoWidget from "./TodoWidget";
import ClockWidget from "./ClockWidget";
import MarketsWidget from "./MarketsWidget";
import ReleasesWidget from "./ReleasesWidget";
import ServerWidget from "./ServerWidget";
import MonitorWidget from "./MonitorWidget";
import DockerWidget from "./DockerWidget";
import DnsWidget from "./DnsWidget";
import EmbedWidget from "./EmbedWidget";
import FootballWidget from "./FootballWidget";
import RepositoryWidget from "./RepositoryWidget";
import ChangesWidget from "./ChangesWidget";
import HtmlWidget from "./HtmlWidget";
import TwitchWidget from "./TwitchWidget";
import BankWidget from "./BankWidget";
import CustomWidget from "./CustomWidget";
import type { BankWidgetDef } from "@/lib/widgetBank";
const ReaderWidget = dynamic(() => import("./ReaderWidget"), { ssr: false });
const ChessWidget = dynamic(() => import("./ChessWidget"), { ssr: false });
const TvWidget = dynamic(() => import("./TvWidget"), { ssr: false });

type WidgetProps = { widget: Widget; className?: string };
const WIDGET_COMPONENTS: Record<Exclude<WidgetType, "custom" | "ext" | "empty">, ComponentType<WidgetProps>> = {
  notebook: NotebookWidget,
  text: TextWidget,
  rss: RssWidget,
  reddit: RedditWidget,
  youtube: YoutubeWidget,
  ebook: ReaderWidget,
  f1: F1Widget,
  weather: WeatherWidget,
  calendar: CalendarWidget,
  schedule: ScheduleWidget,
  arxiv: ArxivWidget,
  hf: HuggingFaceWidget,
  tracker: TrackerWidget,
  rhythm: RhythmWidget,
  upkeep: UpkeepWidget,
  deficit: DeficitWidget,
  bookmarks: BookmarksWidget,
  typing: TypingWidget,
  chess: ChessWidget,
  tv: TvWidget,
  chat: ChatWidget,
  kiwix: KiwixWidget,
  anytype: AnytypeWidget,
  search: SearchWidget,
  todo: TodoWidget,
  clock: ClockWidget,
  markets: MarketsWidget,
  releases: ReleasesWidget,
  server: ServerWidget,
  monitor: MonitorWidget,
  docker: DockerWidget,
  dns: DnsWidget,
  embed: EmbedWidget,
  football: FootballWidget,
  repository: RepositoryWidget,
  changes: ChangesWidget,
  html: HtmlWidget,
  twitch: TwitchWidget,
};

export function renderWidget(widget: Widget, extraClass = "", bankDefs: Record<string, BankWidgetDef> = {}) {
  const cls = `h-full ${extraClass}`;
  if (widget.type === "custom") return <BankWidget widget={widget} def={widget.bankId ? bankDefs[widget.bankId] : undefined} className={cls} />;
  if (widget.type === "ext") return <CustomWidget widget={widget} className={cls} />;
  const Component = widget.type === "empty" ? undefined : WIDGET_COMPONENTS[widget.type];
  if (Component) return <Component widget={widget} className={cls} />;
  return <WidgetCard widget={widget} className={cls} />;
}
