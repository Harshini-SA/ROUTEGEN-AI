import React from 'react';
import { FileText, Trash2 } from 'lucide-react';

interface UploadedFile {
  filename: string;
  chunks: number;
}

interface DocumentsPanelProps {
  files: UploadedFile[];
  onClear: () => void;
}

const DocumentsPanel = ({ files, onClear }: DocumentsPanelProps) => {
  return (
    <div className="bg-surface rounded-xl border border-surface/50 p-4 shadow-lg">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          Documents Uploaded
        </h3>
        {files.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-danger hover:text-danger/80 transition-colors"
            title="Clear all documents for this session"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {files.length === 0 ? (
        <p className="text-xs text-text-secondary">No documents uploaded yet. Attach a PDF, PPTX, or image to enable RAG.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li key={`${f.filename}-${i}`} className="flex items-center justify-between bg-background rounded-lg border border-border px-3 py-2">
              <span className="text-xs text-text-primary truncate">{f.filename}</span>
              <span className="text-xs text-text-secondary shrink-0 ml-2">{f.chunks} chunks</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DocumentsPanel;
