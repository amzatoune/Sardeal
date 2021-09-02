class MessageHelpers {
  // Public: Checks whether the message text contains an @-mention for the
  // given user.
  static containsUserMention(messageText, userId) {
    let userTag = `<@!${userId}>`;
    let userTag_ = `<@${userId}>`;
    return messageText && (messageText.startsWith(userTag) || messageText.startsWith(userTag_));
  }
  static find_a_dm(members, id) {
    let found = undefined;
    members.every((member) => { if (member.user.id == id) {found = member; return false;} return true; });
    return found;
  }
}

module.exports = MessageHelpers;