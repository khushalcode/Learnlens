"use client";
// Real student submission form.
// - Lists enrolled assignments
// - Renders the right input based on assignment type (TEXT/IMAGE/AUDIO/VIDEO)
// - Shows a deadline countdown
// - Allows resubmission before the deadline
// - POSTs to /api/submissions (multipart for files, JSON for text)
// - Triggers AI analysis on the backend (the POST handler does this)

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { differenceInSeconds } from "date-fns";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileUploader } from "@/components/student/file-uploader";
import { toast } from "sonner";
import {
  Clock, Send, AlertCircle, CheckCircle2, RefreshCw, FileText,
  ImageIcon, Music, Video, ArrowLeft,
} from "lucide-react";

interface SubmissionFormProps {
  user: { id: string; email: string; name: string; role: string };
  onDone?: () => void;
}

const TYPE_META = {
  TEXT: { label: "Text submission", icon: FileText, accept: "" },
  IMAGE: { label: "Image upload", icon: ImageIcon, accept: "image/jpeg,image/png,image/webp,image/gif" },
  AUDIO: { label: "Audio upload", icon: Music, accept: "audio/mpeg,audio/wav,audio/ogg,audio/mp4" },
  VIDEO: { label: "Video upload", icon: Video, accept: "video/mp4,video/webm,video/ogg,video/quicktime" },
} as const;

export function SubmissionForm({ user, onDone }: SubmissionFormProps) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // Fetch enrolled assignments with existing submission info
  const { data: assignments, isLoading } = useQuery({
    queryKey: ["student-assignments", user.id],
    queryFn: async () => {
      const r = await fetch("/api/assignments?student=true");
      if (!r.ok) throw new Error("Failed to load assignments");
      const j = await r.json();
      return (j.assignments ?? j) as any[];
    },
  });

  const selected = useMemo(
    () => assignments?.find((a) => a.id === selectedId) ?? null,
    [assignments, selectedId]
  );

  // Reset form state when selection changes
  function selectAssignment(id: string) {
    setSelectedId(id);
    setTextContent("");
    setFile(null);
  }

  // Submit mutation
  const submitMut = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No assignment selected");
      const formData = new FormData();
      formData.append("assignmentId", selected.id);
      if (selected.type === "TEXT") {
        if (!textContent.trim()) throw new Error("Please write your submission first.");
        formData.append("content", textContent);
      } else {
        if (!file) throw new Error("Please choose a file to upload.");
        formData.append("file", file);
        formData.append("mimeType", file.type);
      }
      const r = await fetch("/api/submissions", { method: "POST", body: formData });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || "Submission failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast.success("Submitted! AI analysis is running in the background.");
      qc.invalidateQueries({ queryKey: ["student-assignments", user.id] });
      qc.invalidateQueries({ queryKey: ["student-dashboard", user.id] });
      setSelectedId(null);
      setTextContent("");
      setFile(null);
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── Deadline countdown ───────────────────────────────────
  const deadline = selected?.deadline ? new Date(selected.deadline) : null;
  const now = new Date();
  const secsLeft = deadline ? differenceInSeconds(deadline, now) : 0;
  const closed = deadline ? secsLeft <= 0 : false;
  const isResubmit = selected?.submission ? true : false;

  // ─── Loading state ─────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  // ─── No assignment selected → show list ──────────────────
  if (!selected) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Submit Work</h2>
          <p className="text-sm text-slate-600 mt-1">
            Choose an assignment to submit or resubmit. Files are stored in the
            <code className="px-1 py-0.5 bg-slate-100 rounded mx-1 text-xs">submissions</code>
            bucket and AI analysis runs automatically.
          </p>
        </div>

        <div className="grid gap-3">
          {assignments?.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-slate-500 text-sm">
                No enrolled assignments yet.
              </CardContent>
            </Card>
          )}
          {assignments?.map((a) => {
            const TypeIcon = TYPE_META[a.type as keyof typeof TYPE_META]?.icon ?? FileText;
            const dl = new Date(a.deadline);
            const secs = differenceInSeconds(dl, new Date());
            const isClosed = secs <= 0;
            const hasSub = !!a.submission;
            return (
              <Card
                key={a.id}
                className="hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer"
                onClick={() => selectAssignment(a.id)}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                    <TypeIcon className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{a.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {a.courseCode} · Due {dl.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasSub && (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Submitted
                      </Badge>
                    )}
                    {isClosed ? (
                      <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
                        Closed
                      </Badge>
                    ) : hasSub ? (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                        <RefreshCw className="h-3 w-3 mr-1" /> Resubmit
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                        <Clock className="h-3 w-3 mr-1" />
                        {Math.floor(secs / 3600)}h left
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Assignment detail form ──────────────────────────────
  const TypeIcon = TYPE_META[selected.type as keyof typeof TYPE_META]?.icon ?? FileText;
  const meta = TYPE_META[selected.type as keyof typeof TYPE_META];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => selectAssignment("")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div>
          <h2 className="text-xl font-bold tracking-tight">{selected.title}</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {selected.courseCode} · {meta.label}
          </p>
        </div>
      </div>

      {selected.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Assignment description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{selected.description}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-indigo-600" />
            <div>
              <p className="text-sm font-medium">Deadline</p>
              <p className="text-xs text-slate-500">{deadline?.toLocaleString()}</p>
            </div>
          </div>
          {closed ? (
            <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
              <AlertCircle className="h-3 w-3 mr-1" /> Closed
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
              {Math.floor(secsLeft / 86400)}d {Math.floor((secsLeft % 86400) / 3600)}h {Math.floor((secsLeft % 3600) / 60)}m left
            </Badge>
          )}
        </CardContent>
      </Card>

      {isResubmit && selected.submission && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 flex items-center gap-3">
            <RefreshCw className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-amber-800">You have already submitted this assignment</p>
              <p className="text-amber-700 mt-0.5">
                Submitted at {new Date(selected.submission.submittedAt).toLocaleString()}.
                {closed ? " Deadline has passed — resubmission is closed." : " You can resubmit before the deadline."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TypeIcon className="h-5 w-5 text-indigo-600" />
            {selected.type === "TEXT" ? "Write your submission" : "Upload your file"}
          </CardTitle>
          <CardDescription>
            {selected.type === "TEXT"
              ? "Type or paste your answer below."
              : `Allowed: ${meta.accept}. Max 50 MB.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selected.type === "TEXT" ? (
            <div className="space-y-2">
              <Label htmlFor="content">Content</Label>
              <Textarea
                id="content"
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Write your submission here..."
                rows={10}
                disabled={closed || submitMut.isPending}
              />
              <p className="text-xs text-slate-500">{textContent.length} characters</p>
            </div>
          ) : (
            <FileUploader
              accept={meta.accept}
              onFileSelected={setFile}
              helperText="Drag & drop or click to browse"
              maxSizeMB={50}
            />
          )}

          {/* Rubric preview */}
          {selected.rubric?.criteria?.length > 0 && (
            <div className="pt-3 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">
                Rubric
              </p>
              <ul className="space-y-1.5">
                {selected.rubric.criteria.map((c: any) => (
                  <li key={c.id} className="text-sm flex items-center justify-between">
                    <span className="text-slate-700">{c.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {Math.round(c.weight * 100)}% · max {c.maxScore}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="ghost" onClick={() => selectAssignment("")} disabled={submitMut.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => submitMut.mutate()}
              disabled={closed || submitMut.isPending || (selected.type === "TEXT" ? !textContent.trim() : !file)}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {submitMut.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" /> Uploading...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1" />
                  {isResubmit ? "Resubmit" : "Submit"}
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
