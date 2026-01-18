import type { Session, Contact } from './types.js';

/**
 * Substitute template variables in a string using property path notation
 * Supports: {{contact.propertyPath}} and {{session.propertyPath}}
 * Examples: {{contact.fullName}}, {{session.id}}, {{session.context.accountType}}
 */
export function substituteTemplateVariables(
  template: string,
  session: Session,
  contact?: Contact
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const trimmedPath = path.trim();
    
    if (trimmedPath.startsWith('contact.')) {
      if (!contact) return '';
      return getNestedProperty(contact, trimmedPath.substring(8)) ?? '';
    }
    
    if (trimmedPath.startsWith('session.')) {
      return getNestedProperty(session, trimmedPath.substring(8)) ?? '';
    }
    
    // Unknown pattern - return as-is
    return match;
  });
}

/**
 * Get nested property from object using dot notation
 * Example: getNestedProperty(obj, 'context.userName') → obj.context.userName
 */
export function getNestedProperty(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}
