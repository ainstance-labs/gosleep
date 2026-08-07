// @gosleep/web — Cost screen (GSL-265).
//
// The v1 /cost endpoint returns raw `cost.*` events; a proper aggregation table lands with
// the fleet dashboard task. Here we roll up client-side by UTC day so the owner sees a
// simple daily line + a running total, then a table of the underlying events.

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import { useCost } from "../data/queries";
import { TBody, TD, TH, THead, TR, Table } from "../components/ui/Table";
import { timeAgo, timeOfDay } from "../lib/format";
import { useTheme } from "../theme/ThemeProvider";

interface PayloadWithUsd {
  usd?: number;
  amount_usd?: number;
  cost?: number;
  tokens?: number;
}

function extractUsd(payload: unknown): number | null {
  if (payload === null || typeof payload !== "object") return null;
  const p = payload as PayloadWithUsd;
  if (typeof p.usd === "number") return p.usd;
  if (typeof p.amount_usd === "number") return p.amount_usd;
  if (typeof p.cost === "number") return p.cost;
  return null;
}

export function CostScreen() {
  const cost = useCost(120);
  const { effective } = useTheme();

  const chartStroke = effective === "dark" ? "#7ab0ff" : "#2563eb";
  const gridStroke = effective === "dark" ? "#2a2b2f" : "#e6e7ea";
  const axisStroke = effective === "dark" ? "#7f838a" : "#6b6f78";

  const dailySeries = useMemo(() => {
    const by = new Map<string, number>();
    for (const e of cost.data?.cost_events ?? []) {
      const usd = extractUsd(e.payload);
      if (usd === null) continue;
      by.set(e.day, (by.get(e.day) ?? 0) + usd);
    }
    return Array.from(by.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, usd]) => ({ day, usd: Number(usd.toFixed(4)) }));
  }, [cost.data]);

  const totals = useMemo(() => {
    let usdTotal = 0;
    let unknownRows = 0;
    for (const e of cost.data?.cost_events ?? []) {
      const usd = extractUsd(e.payload);
      if (usd === null) unknownRows++;
      else usdTotal += usd;
    }
    return { usdTotal, unknownRows };
  }, [cost.data]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cost"
        subtitle="v1 roll-up of cost.* events. Aggregation table lands with the fleet dashboard task."
      />

      <QueryStatus
        isPending={cost.isPending}
        error={cost.error}
        data={cost.data}
        isEmpty={(d) => d.cost_events.length === 0}
        emptyMessage="No cost events recorded yet."
      >
        {(d) => (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Card>
                <CardBody className="py-4">
                  <div className="text-muted text-xs uppercase tracking-wide">
                    Total (extracted)
                  </div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">
                    ${totals.usdTotal.toFixed(2)}
                  </div>
                  <div className="text-muted mt-1 text-xs">
                    from {d.cost_events.length - totals.unknownRows} priced events
                  </div>
                </CardBody>
              </Card>
              <Card>
                <CardBody className="py-4">
                  <div className="text-muted text-xs uppercase tracking-wide">
                    Events observed
                  </div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">
                    {d.count}
                  </div>
                  <div className="text-muted mt-1 text-xs">
                    {totals.unknownRows} without a usd/cost field
                  </div>
                </CardBody>
              </Card>
              <Card>
                <CardBody className="py-4">
                  <div className="text-muted text-xs uppercase tracking-wide">
                    Days spanned
                  </div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums">
                    {dailySeries.length}
                  </div>
                  <div className="text-muted mt-1 text-xs">
                    UTC day buckets in the latest {d.count} events
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Daily spend (USD)</CardTitle>
                <span className="text-muted text-xs">from cost.* payload fields</span>
              </CardHeader>
              <CardBody>
                {dailySeries.length === 0 ? (
                  <p className="text-muted text-sm">
                    No parseable usd/cost fields on the observed events.
                  </p>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={dailySeries}>
                        <CartesianGrid stroke={gridStroke} vertical={false} />
                        <XAxis
                          dataKey="day"
                          stroke={axisStroke}
                          fontSize={11}
                          tickLine={false}
                        />
                        <YAxis stroke={axisStroke} fontSize={11} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            background: "var(--color-surface)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="usd"
                          stroke={chartStroke}
                          fill={chartStroke}
                          fillOpacity={0.18}
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Raw cost.* events</CardTitle>
                <span className="text-muted text-xs">latest {d.count}</span>
              </CardHeader>
              <CardBody className="p-0">
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-24">Seq</TH>
                      <TH className="w-32">Day</TH>
                      <TH className="w-28">Time</TH>
                      <TH>Payload</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {d.cost_events.slice(0, 100).map((e) => (
                      <TR key={e.seq}>
                        <TD className="mono text-xs">{e.seq}</TD>
                        <TD className="mono text-xs">{e.day}</TD>
                        <TD className="mono text-muted text-xs">
                          {timeOfDay(e.ts)} · {timeAgo(e.ts)}
                        </TD>
                        <TD>
                          <pre className="mono text-muted overflow-x-auto text-xs">
                            {typeof e.payload === "string"
                              ? e.payload
                              : JSON.stringify(e.payload)}
                          </pre>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          </>
        )}
      </QueryStatus>
    </div>
  );
}
