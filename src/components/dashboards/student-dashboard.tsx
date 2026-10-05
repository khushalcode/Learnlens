"use client";

import { useQuery } from "@tanstack/react-query";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SubmissionForm } from "@/components/student/submission-form";
import {
  TrendingUp, AlertTriangle, Brain, MessageSquare, FileText, Target,
} from "lucide-react";

interface StudentDashboardProps {
  user: { id: string; email: string; name: string; role: string };
  view: string;
}

export function StudentDashboard({ user, view }: StudentDashboardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["student-dashboard", user.id],
    queryFn: async () => {
      const r = await fetch("/api/dashboard/student");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (!data) return <div>Failed to load dashboard.</div>;

  const chartData = (data.learningCurve || []).map((lc: any) => {
    const classAvg = (data.classAverage || []).find((c: any) => c.assignmentId === lc.assignmentId);
    return {
      name: lc.assignmentTitle.split(":")[0].replace("Assignment ", "A"),
      score: lc.score,
      classAvg: classAvg?.avgScore ?? 0,
      fullTitle: lc.assignmentTitle,
    };
  });

  if (view === "submissions") return <SubmissionsView data={data} />;
  if (view === "submit") return <SubmissionForm user={user} />;
  if (view === "insights") return <InsightsView data={data} />;

  const weakComps = (data.competencies || []).filter((c: any) => c.weak);
  const avgScore = data.avgScore ?? 0;

  return (
    <div
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Welcome back, {user.name.split(" ")[0]}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your learning analytics across {data.submissionsCount} submissions.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard label="Average Score" value={`${avgScore.toFixed(1)}%`} icon={TrendingUp}
          tone={avgScore >= 75 ? "success" : avgScore >= 60 ? "neutral" : "warn"} />
        <MetricCard label="Submissions" value={data.submissionsCount} icon={FileText} tone="neutral" />
        <MetricCard label="Weak Areas" value={weakComps.length} icon={AlertTriangle}
          tone={weakComps.length > 0 ? "warn" : "success"} />
        <MetricCard label="Recent Feedback" value={data.recentFeedback?.length || 0} icon={MessageSquare} tone="neutral" />
      </div>

      <Card className="transition-all hover:shadow-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-indigo-600" />
            Learning Curve
          </CardTitle>
          <CardDescription>Your score per assignment vs. class average</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip
                  contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13 }}
                  formatter={(v: any) => `${v}%`}
                  labelFormatter={(l: any) => chartData.find((d: any) => d.name === l)?.fullTitle || l}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="score" name="Your Score" stroke="#4f46e5" strokeWidth={2.5}
                  dot={{ r: 5, fill: "#4f46e5" }} activeDot={{ r: 7 }} />
                <Line type="monotone" dataKey="classAvg" name="Class Average" stroke="#94a3b8"
                  strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-indigo-600" />
              Competency Mastery
            </CardTitle>
            <CardDescription>Average score by CO/PO code</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data.competencies || []).map((c: any) => (
              <div key={c.code}>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-medium text-slate-700">{c.code}</span>
                  <span className={`font-semibold ${c.weak ? "text-rose-600" : "text-slate-700"}`}>
                    {c.avgScore.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${c.weak ? "bg-rose-500" : "bg-indigo-500"}`}
                    style={{ width: `${c.avgScore}%` }} />
                </div>
                {c.weak && (
                  <p className="text-xs text-rose-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Below 60% — needs attention
                  </p>
                )}
              </div>
            ))}
            {!data.competencies?.length && (
              <EmptyState icon={Target} title="No competency data yet"
                description="Your CO/PO mastery will appear here once you have graded submissions." />
            )}
          </CardContent>
        </Card>

        <Card className="transition-all hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-indigo-600" />
              Recent Feedback
            </CardTitle>
            <CardDescription>From faculty on your submissions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {(data.recentFeedback || []).map((f: any) => (
              <div key={f.id} className="border-l-2 border-indigo-200 pl-3 py-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-500">{f.assignmentTitle}</span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(f.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-sm text-slate-700">{f.text}</p>
                <p className="text-[10px] text-slate-500 mt-1">— {f.author?.name}</p>
              </div>
            ))}
            {!data.recentFeedback?.length && (
              <EmptyState icon={MessageSquare} title="No feedback yet"
                description="Your instructor will leave feedback here after evaluating your submissions." />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  label, value, icon: Icon, tone,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  tone: "success" | "warn" | "neutral";
}) {
  const toneClasses = {
    success: "text-indigo-700 bg-indigo-50",
    warn: "text-rose-700 bg-rose-50",
    neutral: "text-slate-700 bg-slate-100",
  }[tone];
  return (
    <Card className="p-4 transition-all hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 mb-1">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${toneClasses}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function EmptyState({
  icon: Icon, title, description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-8 px-4">
      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mb-2">
        <Icon className="h-5 w-5 text-slate-400" />
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-xs">{description}</p>
    </div>
  );
}

function SubmissionsView({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Submissions</h1>
        <p className="text-sm text-slate-600 mt-1">All your assignment submissions with scores and AI analysis.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-slate-100">
            {(data.learningCurve || []).map((lc: any, i: number) => {
              const aiReport = (data.aiReports || []).find((r: any) => r.assignmentTitle === lc.assignmentTitle);
              return (
                <div key={i} className="p-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">{lc.assignmentTitle}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Submitted {new Date(lc.submittedAt).toLocaleDateString()} · CO: {lc.competencyCode || "—"}
                      </p>
                      {aiReport && (
                        <div className="mt-2 flex items-center gap-3 text-xs flex-wrap">
                          <Badge variant="outline" className="bg-slate-50">AI Similarity: {aiReport.similarity}%</Badge>
                          <Badge variant="outline" className="bg-slate-50">Auto-Score: {aiReport.autoScore}%</Badge>
                        </div>
                      )}
                      {aiReport?.feedbackText && (
                        <p className="text-xs text-slate-600 mt-2 italic border-l-2 border-indigo-200 pl-2">
                          {aiReport.feedbackText}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-2xl font-bold text-indigo-700">{lc.score.toFixed(1)}%</p>
                      <p className="text-xs text-slate-500">final score</p>
                    </div>
                  </div>
                </div>
              );
            })}
            {!data.learningCurve?.length && (
              <EmptyState icon={FileText} title="No submissions yet"
                description="Your submitted assignments will appear here once you start submitting." />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SubmitWorkView({ user }: { user: any }) {
  return <SubmissionForm user={user} />;
}

function InsightsView({ data }: { data: any }) {
  const reports = (data.aiReports || []).filter((r: any) => r.similarity !== null);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="h-6 w-6 text-indigo-600" />
          AI Insights
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Mock AI analysis — similarity %, auto-score suggestions, and rule-based feedback for each submission.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {reports.map((r: any, i: number) => (
          <Card key={i}>
            <CardHeader>
              <CardTitle className="text-sm">{r.assignmentTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-50">
                  <p className="text-xs text-slate-500">Similarity</p>
                  <p className={`text-2xl font-bold ${r.similarity > 60 ? "text-rose-600" : r.similarity > 35 ? "text-amber-600" : "text-indigo-700"}`}>
                    {r.similarity}%
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50">
                  <p className="text-xs text-slate-500">AI Auto-Score</p>
                  <p className="text-2xl font-bold text-slate-900">{r.autoScore}%</p>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                <p className="text-xs font-medium text-indigo-700 mb-1">Generated Feedback</p>
                <p className="text-sm text-slate-700">{r.feedbackText}</p>
              </div>
            </CardContent>
          </Card>
        ))}
        {!reports.length && (
          <Card className="col-span-full">
            <CardContent className="p-0">
              <EmptyState icon={Brain} title="No AI analysis reports yet"
                description="AI similarity and auto-score reports are generated automatically when you submit work." />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
