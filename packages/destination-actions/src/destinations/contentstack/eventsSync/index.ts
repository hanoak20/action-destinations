import type { ActionDefinition } from '@segment/actions-core'
import type { Settings } from '../generated-types'
import type { Payload } from './generated-types'
import { getNewAuth } from '../utils'
import { PERSONALIZE_APIS, PERSONALIZE_EDGE_APIS } from '../constants'

const action: ActionDefinition<Settings, Payload> = {
  title: 'Events Sync',
  description: 'Sync Events to your Contentstack Experience.',
  defaultSubscription: 'type = "track"',
  fields: {
    userId: {
      type: 'string',
      default: { '@path': '$.userId' },
      label: 'User ID',
      description: 'ID for the user',
      required: false
    },
    event: {
      type: 'string',
      default: { '@path': '$.event' },
      label: 'User Event',
      description: 'User Event',
      required: false
    }
  },
  perform: async (request, { payload, auth }) => {
    const newAuth = getNewAuth(auth?.accessToken as string)

    if (payload.event) {
      // Creates Event
      await request(`${PERSONALIZE_APIS[newAuth.location]}/events`, {
        method: 'post',
        json: {
          key: payload.event,
          description: `${payload.event} description`
        }
      })

      //Ingest Event
      return request(`${PERSONALIZE_EDGE_APIS[newAuth.location]}/events`, {
        method: 'patch',
        json: {
          eventKey: payload.event,
          type: 'EVENT'
        },
        headers: {
          'x-cs-eclipse-user-uid': payload.userId ?? ''
        }
      })
    }
  }
}

export default action
