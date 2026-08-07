// @gosleep/web — react-router 7 data-router (GSL-265).
//
// Uses the "data router" API (createBrowserRouter) so route-level loading + errors flow
// through a standard error boundary. All five read-only screens share the AppShell layout
// (sidebar + top bar).

import { createBrowserRouter, Navigate } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { OverviewScreen } from "./screens/Overview";
import { TimelineScreen } from "./screens/Timeline";
import { QuestionsScreen } from "./screens/Questions";
import { TasksScreen } from "./screens/Tasks";
import { CostScreen } from "./screens/Cost";
import { RouteError } from "./components/RouteError";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: "overview", element: <OverviewScreen /> },
      { path: "timeline", element: <TimelineScreen /> },
      { path: "questions", element: <QuestionsScreen /> },
      { path: "tasks", element: <TasksScreen /> },
      { path: "cost", element: <CostScreen /> },
      { path: "*", element: <Navigate to="/overview" replace /> },
    ],
  },
]);
