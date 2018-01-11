// @flow

export default async (
  _: any,
  { message }: AddMessageProps,
  { user, loaders }: GraphQLContext
) => {
  const currentUser = user;
  // user must be authed to send a message
  if (!currentUser) {
    return new UserError('You must be signed in to send a message.');
  }

  const thread = await getThread(message.threadId);

  // if the message was a dm thread, set the last seen and last active times
  if (message.threadType === 'directMessageThread') {
    setDirectMessageThreadLastActive(message.threadId);
    setUserLastSeenInDirectMessageThread(message.threadId, currentUser.id);
  }

  // if the message was sent in a story thread, create a new participant
  // relationship to the thread - this will enable us to query against
  // thread.participants as well as have per-thread notifications for a user
  if (message.threadType === 'story' && (thread && !thread.watercooler)) {
    createParticipantInThread(message.threadId, currentUser.id);
  }

  if (thread && thread.watercooler) {
    createParticipantWithoutNotificationsInThread(
      message.threadId,
      currentUser.id
    );
  }

  // all checks passed
  if (message.messageType === 'text' || message.messageType === 'draftjs') {
    // send a normal text message
    return storeMessage(message, currentUser.id)
      .then(async message => {
        if (message.threadType === 'directMessageThread') return message;
        const { communityId } = await loaders.thread.load(message.threadId);
        const permissions = await loaders.userPermissionsInCommunity.load([
          message.senderId,
          communityId,
        ]);

        return {
          ...message,
          contextPermissions: {
            reputation: permissions ? permissions.reputation : 0,
            isModerator: permissions ? permissions.isModerator : false,
            isOwner: permissions ? permissions.isOwner : false,
          },
        };
      })
      .catch(err => new UserError(err.message));
  } else if (message.messageType === 'media') {
    // upload the photo, return the photo url, then store the message

    return uploadImage(message.file, 'threads', message.threadId)
      .then(url => {
        // build a new message object with a new file field with metadata
        const newMessage = Object.assign({}, message, {
          content: {
            body: url,
          },
          file: {
            name: message.file.name,
            size: message.file.size,
            type: message.file.type,
          },
        });
        return newMessage;
      })
      .then(newMessage => storeMessage(newMessage, currentUser.id))
      .then(async message => {
        if (message.threadType === 'directMessageThread') return message;
        const { communityId } = await loaders.thread.load(message.threadId);
        const permissions = await loaders.userPermissionsInCommunity.load([
          message.senderId,
          communityId,
        ]);

        return {
          ...message,
          contextPermissions: {
            communityId,
            reputation: permissions ? permissions.reputation : 0,
            isModerator: permissions ? permissions.isModerator : false,
            isOwner: permissions ? permissions.isOwner : false,
          },
        };
      })
      .catch(err => new UserError(err.message));
  } else {
    return new UserError('Unknown message type');
  }
};