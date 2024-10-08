import { APIError, DestinationDefinition, RetryableError } from '@segment/actions-core'
import type { Settings } from './generated-types'
// This has to be 'cases' because 'case' is a Javascript reserved word
import cases from './cases'
import lead from './lead'
import opportunity from './opportunity'
import customObject from './customObject'
import contact from './contact'
import account from './account'
import { authenticateWithPassword } from './sf-operations'

interface RefreshTokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

const destination: DestinationDefinition<Settings> = {
  name: 'Salesforce (Actions)',
  slug: 'actions-salesforce',
  mode: 'cloud',

  authentication: {
    scheme: 'oauth2',
    fields: {
      instanceUrl: {
        label: 'Instance URL',
        description:
          'The user specific instance URL returned by Salesforce Oauth. This setting is hidden to the user and set by Oauth Service.',
        type: 'string',
        required: true
      },
      isSandbox: {
        label: 'Sandbox Instance',
        description:
          'Enable to authenticate into a sandbox instance. You can log in to a sandbox by appending the sandbox name to your Salesforce username. For example, if a username for a production org is user@acme.com and the sandbox is named test, the username to log in to the sandbox is user@acme.com.test. If you are already authenticated, please disconnect and reconnect with your sandbox username.',
        type: 'boolean',
        default: false
      },
      username: {
        label: 'Username',
        description:
          'The username of the Salesforce account you want to connect to. When all three of username, password, and security token are provided, a username-password flow is used to authenticate. This field is hidden to all users except those who have opted in to the username+password flow.',
        type: 'string'
      },
      auth_password: {
        // auth_ prefix is used because password is a reserved word
        label: 'Password',
        description:
          'The password of the Salesforce account you want to connect to. When all three of username, password, and security token are provided, a username-password flow is used to authenticate. This field is hidden to all users except those who have opted in to the username+password flow.',
        type: 'string'
      },
      security_token: {
        label: 'Security Token',
        description:
          'The security token of the Salesforce account you want to connect to. When all three of username, password, and security token are provided, a username-password flow is used to authenticate. This value will be appended to the password field to construct the credential used for authentication. This field is hidden to all users except those who have opted in to the username+password flow.',
        type: 'string'
      }
    },
    refreshAccessToken: async (request, { auth, settings }) => {
      if (settings.username && settings.auth_password) {
        const { accessToken } = await authenticateWithPassword(
          settings.username,
          settings.auth_password,
          settings.security_token,
          settings.isSandbox
        )

        return { accessToken }
      }

      // Return a request that refreshes the access_token if the API supports it
      const baseUrl = settings.isSandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com'
      const res = await request<RefreshTokenResponse>(`${baseUrl}/services/oauth2/token`, {
        method: 'POST',
        body: new URLSearchParams({
          refresh_token: auth.refreshToken,
          client_id: auth.clientId,
          client_secret: auth.clientSecret,
          grant_type: 'refresh_token'
        }),
        throwHttpErrors: false
      })

      if (res.ok) {
        return { accessToken: res.data?.access_token as string }
      }

      // Salesforce returns a 400 error when concurrently refreshing token with same access token.
      // https://help.salesforce.com/s/articleView?language=en_US&id=release-notes.rn_security_refresh_token_requests.htm&release=250&type=5
      if (
        res.status == 400 &&
        res.data?.error === 'invalid_grant' &&
        res.data?.error_description &&
        // As of Aug 2024, salesforce returns "expired authorization code" as error description. But salesforce is expected to return
        // "token request is already being processed" from september on. So, covering both scenarios so that
        // we don't have to update the code again.
        // https://help.salesforce.com/s/articleView?id=release-notes.rn_security_refresh_token_error.htm&release=252&type=5
        ['token request is already being processed', 'expired authorization code'].includes(res.data?.error_description)
      ) {
        // Under heavy load/thundering herd, it might be better to retry after a while.
        throw new RetryableError('Concurrent token refresh error. This request will be retried')
      }
      throw new APIError(res.data?.error_description ?? 'Failed to refresh access token', res.status)
    }
  },
  extendRequest({ auth }) {
    return {
      headers: {
        authorization: `Bearer ${auth?.accessToken}`
      }
    }
  },

  actions: {
    lead,
    customObject,
    cases,
    contact,
    opportunity,
    account
  }
}

export default destination
