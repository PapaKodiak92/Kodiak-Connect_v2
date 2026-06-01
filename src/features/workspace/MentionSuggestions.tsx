import type { MentionSuggestion } from './mentionSuggestions';

interface MentionSuggestionsProps {
  onSelect: (suggestion: MentionSuggestion) => void;
  suggestions: MentionSuggestion[];
}

export function MentionSuggestions({ onSelect, suggestions }: MentionSuggestionsProps) {
  if (!suggestions.length) {
    return null;
  }

  return (
    <div className="message-mention-suggestions" role="listbox" aria-label="Mention suggestions">
      {suggestions.map((suggestion) => (
        <button key={suggestion.userId} type="button" onClick={() => onSelect(suggestion)}>
          <span>@{suggestion.localpart}</span>
          <small>{suggestion.displayName}</small>
        </button>
      ))}
    </div>
  );
}
