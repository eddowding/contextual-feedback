'use client';

import { useState, useEffect, useMemo } from 'react';
import { Feedback, FeedbackStatus } from '../lib/types';

export type ExportFormat = 'default' | 'ai-triage';

export interface FeedbackListProps {
  /** Initial feedback data (server-side) */
  initialFeedback?: Feedback[];
  /** API endpoint for fetching feedback. Defaults to '/api/feedback' */
  apiEndpoint?: string;
  /** Fetch feedback on mount. Defaults to true if no initialFeedback */
  fetchOnMount?: boolean;
  /** Status filter */
  statusFilter?: FeedbackStatus;
  /** Custom status change handler (overrides API call) */
  onStatusChange?: (id: string, status: FeedbackStatus) => Promise<void>;
  /** Custom class name for the container */
  className?: string;
  /** Show copy buttons */
  showCopyButtons?: boolean;
  /** Date format locale. Defaults to 'en-US' */
  dateLocale?: string;
  /** Number of items per page. Defaults to 20 */
  pageSize?: number;
  /** Export format for JSON buttons. Defaults to 'default' */
  exportFormat?: ExportFormat;
}

const STATUS_COLORS: Record<FeedbackStatus, string> = {
  Pending: 'cf-status-pending',
  'In Review': 'cf-status-review',
  Done: 'cf-status-done',
  Rejected: 'cf-status-rejected',
};

export function FeedbackList({
  initialFeedback,
  apiEndpoint = '/api/feedback',
  fetchOnMount,
  statusFilter,
  onStatusChange,
  className,
  showCopyButtons = true,
  dateLocale = 'en-US',
  pageSize = 20,
  exportFormat = 'default',
}: FeedbackListProps) {
  const [feedback, setFeedback] = useState<Feedback[]>(initialFeedback || []);
  const [loading, setLoading] = useState(!initialFeedback && fetchOnMount !== false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(feedback.length / pageSize));
  const paginatedFeedback = useMemo(
    () => feedback.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
    [feedback, currentPage, pageSize]
  );

  // Reset to first page when feedback data changes
  useEffect(() => {
    setCurrentPage(0);
  }, [feedback.length]);

  // Fetch feedback on mount if needed
  useEffect(() => {
    if (initialFeedback || fetchOnMount === false) return;

    const fetchFeedback = async () => {
      try {
        const url = statusFilter
          ? `${apiEndpoint}?status=${encodeURIComponent(statusFilter)}`
          : apiEndpoint;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch feedback');
        const data = await response.json();
        setFeedback(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load feedback');
      } finally {
        setLoading(false);
      }
    };

    fetchFeedback();
  }, [apiEndpoint, statusFilter, initialFeedback, fetchOnMount]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(dateLocale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFeedbackForExport = (item: Feedback) => {
    let pathname = item.pageUrl;
    try {
      pathname = new URL(item.pageUrl).pathname;
    } catch {
      // Keep original if not a valid URL
    }

    if (exportFormat === 'ai-triage') {
      return {
        id: item.id,
        feedback: item.feedbackText,
        page: pathname,
        section: item.context || 'General',
        elementId: item.elementId || null,
        from: item.userEmail,
        status: item.status,
        submittedAt: item.createdAt,
      };
    }

    return {
      id: item.id,
      user: item.userEmail,
      page: pathname,
      pageUrl: item.pageUrl,
      context: item.context || 'General',
      elementId: item.elementId || null,
      feedback: item.feedbackText,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      adminNotes: item.adminNotes || null,
    };
  };

  const copyToClipboard = async (text: string, id?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (id) {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      } else {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const copyOne = (item: Feedback) => {
    const json = JSON.stringify(formatFeedbackForExport(item), null, 2);
    copyToClipboard(json, item.id);
  };

  const copyAll = () => {
    const json = JSON.stringify(feedback.map(formatFeedbackForExport), null, 2);
    copyToClipboard(json);
  };

  const downloadJson = () => {
    const json = JSON.stringify(feedback.map(formatFeedbackForExport), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feedback-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleStatusChange = async (id: string, newStatus: FeedbackStatus) => {
    try {
      if (onStatusChange) {
        await onStatusChange(id, newStatus);
      } else {
        const response = await fetch(`${apiEndpoint}/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });

        if (!response.ok) throw new Error('Failed to update status');
      }

      setFeedback((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: newStatus, updatedAt: new Date().toISOString() } : f))
      );
    } catch (err) {
      console.error('Error updating feedback status:', err);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const getPathname = (url: string) => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  };

  if (loading) {
    return (
      <div className={`cf-list-container cf-list-loading ${className || ''}`}>
        <div className="cf-list-spinner" />
        <span>Loading feedback...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`cf-list-container cf-list-error ${className || ''}`}>
        <span>{error}</span>
      </div>
    );
  }

  if (feedback.length === 0) {
    return (
      <div className={`cf-list-container cf-list-empty ${className || ''}`}>
        <span>No feedback yet.</span>
      </div>
    );
  }

  return (
    <div className={`cf-list-container ${className || ''}`}>
      {/* Header */}
      <div className="cf-list-header">
        <span className="cf-list-count">
          {feedback.length} item{feedback.length !== 1 ? 's' : ''}
        </span>
        {showCopyButtons && (
          <div className="cf-list-header-actions">
            <button onClick={downloadJson} className="cf-list-copy-all" title="Download as JSON file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download JSON</span>
            </button>
            <button onClick={copyAll} className="cf-list-copy-all">
              {copiedAll ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              <span>{copiedAll ? 'Copied!' : 'Copy All'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <table className="cf-list-table">
        <thead>
          <tr>
            <th className="cf-list-th-expand"></th>
            <th>User</th>
            <th>Page</th>
            <th>Context</th>
            <th>Date</th>
            <th>Status</th>
            {showCopyButtons && <th className="cf-list-th-copy"></th>}
          </tr>
        </thead>
        <tbody>
          {paginatedFeedback.map((item) => (
            <FeedbackRow
              key={item.id}
              item={item}
              expanded={expandedId === item.id}
              onToggle={() => toggleExpand(item.id)}
              onStatusChange={handleStatusChange}
              onCopy={copyOne}
              copied={copiedId === item.id}
              showCopyButton={showCopyButtons}
              formatDate={formatDate}
              getPathname={getPathname}
            />
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="cf-list-pagination">
          <button
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="cf-list-page-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Prev
          </button>
          <span className="cf-list-page-indicator">
            Page {currentPage + 1} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={currentPage >= totalPages - 1}
            className="cf-list-page-btn"
          >
            Next
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

interface FeedbackRowProps {
  item: Feedback;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (id: string, status: FeedbackStatus) => void;
  onCopy: (item: Feedback) => void;
  copied: boolean;
  showCopyButton: boolean;
  formatDate: (date: string) => string;
  getPathname: (url: string) => string;
}

function FeedbackRow({
  item,
  expanded,
  onToggle,
  onStatusChange,
  onCopy,
  copied,
  showCopyButton,
  formatDate,
  getPathname,
}: FeedbackRowProps) {
  const statuses: FeedbackStatus[] = ['Pending', 'In Review', 'Done', 'Rejected'];

  return (
    <>
      <tr onClick={onToggle} className={`cf-list-row ${expanded ? 'cf-list-row-expanded' : ''}`}>
        <td className="cf-list-td-expand">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`cf-list-chevron ${expanded ? 'cf-list-chevron-open' : ''}`}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </td>
        <td className="cf-list-td-user">{item.userEmail.split('@')[0]}</td>
        <td className="cf-list-td-page">
          <a
            href={item.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="cf-list-page-link"
          >
            {getPathname(item.pageUrl)}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        </td>
        <td className="cf-list-td-context">
          {item.context ? (
            <span className="cf-list-context-badge">{item.context}</span>
          ) : (
            <span className="cf-list-context-general">General</span>
          )}
        </td>
        <td className="cf-list-td-date">{formatDate(item.createdAt)}</td>
        <td className="cf-list-td-status" onClick={(e) => e.stopPropagation()}>
          <select
            value={item.status}
            onChange={(e) => onStatusChange(item.id, e.target.value as FeedbackStatus)}
            className={`cf-list-status-select ${STATUS_COLORS[item.status]}`}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </td>
        {showCopyButton && (
          <td className="cf-list-td-copy" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onCopy(item)} className="cf-list-copy-btn" title="Copy as JSON">
              {copied ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </td>
        )}
      </tr>
      {expanded && (
        <tr className="cf-list-details-row">
          <td colSpan={showCopyButton ? 7 : 6}>
            <div className="cf-list-details">
              <div className="cf-list-feedback-text">{item.feedbackText}</div>
              {item.adminNotes && (
                <div className="cf-list-admin-notes">
                  <strong>Admin Notes:</strong>
                  <p>{item.adminNotes}</p>
                </div>
              )}
              <div className="cf-list-meta">
                <span>{item.userEmail}</span>
                <span>Updated: {formatDate(item.updatedAt)}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
