import {
  AddressBook,
  Archive,
  ChatCircleDots,
  DownloadSimple,
  FolderOpen,
  GearSix,
  House,
  MagnifyingGlass,
  UsersThree,
} from "@phosphor-icons/react";
import { lazy } from "react";

// One registry owns navigation labels, icons and lazy workspace boundaries.
export const views = {
  home: {
    id: "home",
    label: "Home",
    icon: House,
    component: lazy(() => import("./workspaces/HomeRoute")),
  },
  search: {
    id: "search",
    label: "Search",
    icon: MagnifyingGlass,
    component: lazy(() => import("./workspaces/FilesRoute")),
  },
  browse: {
    id: "browse",
    label: "Browse",
    icon: FolderOpen,
    component: lazy(() => import("./workspaces/BrowseRoute")),
  },
  messages: {
    id: "messages",
    label: "Messages",
    icon: ChatCircleDots,
    component: lazy(() => import("./workspaces/MessagesRoute")),
  },
  people: {
    id: "people",
    label: "People",
    icon: AddressBook,
    component: lazy(() => import("./workspaces/PeopleRoute")),
  },
  rooms: {
    id: "rooms",
    label: "Rooms",
    icon: UsersThree,
    component: lazy(() => import("./workspaces/RoomsRoute")),
  },
  transfers: {
    id: "transfers",
    label: "Transfers",
    icon: DownloadSimple,
    component: lazy(() => import("./workspaces/TransfersRoute")),
  },
  archive: {
    id: "archive",
    label: "Archive",
    icon: Archive,
    component: lazy(() => import("./workspaces/ArchiveRoute")),
  },
  settings: {
    id: "settings",
    label: "Settings",
    icon: GearSix,
    component: lazy(() => import("./workspaces/SettingsRoute")),
  },
} as const;
export type ViewId =
  | "home"
  | "search"
  | "browse"
  | "messages"
  | "people"
  | "rooms"
  | "transfers"
  | "archive"
  | "settings";
export const primaryViews = Object.values(views).filter(
  (view) => view.id !== "settings",
);
export const AlbumsRoute = lazy(() => import("./workspaces/AlbumsRoute"));
